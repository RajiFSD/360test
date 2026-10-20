/**
 * Smaller periodic jobs: signal lost, auto-complete after return, expiry (incl. daily-pass NO_SHOW), ping retention,
 * and daily-pass trip generation.
 */
const db = require('../db');
const repo = require('../services/repo');
const settingsSvc = require('../services/settings.service');
const tripSvc = require('../services/trip.service');
const daily = require('../services/daily.service');
const { notify } = require('../services/notification.service');
const { emitTo, rooms } = require('../realtime');

/** No ping for signal_lost_min during an active, consented trip -> alert once per trip. */
async function runSignalLostCheck(now = new Date()) {
  const s = await settingsSvc.getAll();
  const cutoff = new Date(now.getTime() - s.signal_lost_min * 60_000);
  const trips = await db.query(
    `SELECT t.id, t.request_id, t.last_ping_at, o.student_id, s.name AS student_name, s.roll_no, c.granted_at
     FROM trips t
     JOIN outpass_requests o ON o.id = t.request_id
     JOIN users s ON s.id = o.student_id
     JOIN tracking_consents c ON c.trip_id = t.id AND c.revoked_at IS NULL
     WHERE t.status IN ('ACTIVE','OVERDUE') AND t.returned_at IS NULL AND t.signal_lost_at IS NULL
       AND COALESCE(t.last_ping_at, GREATEST(t.exit_at, c.granted_at)) < ?`,
    [cutoff],
  );
  let alerted = 0;
  for (const trip of trips) {
    await db.query('UPDATE trips SET signal_lost_at = ? WHERE id = ?', [now, trip.id]);
    if (!(await tripSvc.recordEvent(trip.id, 'SIGNAL_LOST', now, { last_ping_at: trip.last_ping_at }))) continue;
    alerted++;
    tripSvc.broadcastEvent(trip, 'SIGNAL_LOST', now, { last_ping_at: trip.last_ping_at });
    await notify({
      userIds: await repo.wardensFor(trip.student_id),
      type: 'SIGNAL_LOST',
      title: `Signal lost: ${trip.student_name}`,
      body: `No location update from ${trip.student_name} (${trip.roll_no}) for over ${s.signal_lost_min} minutes.`,
      tripId: trip.id,
    });
    await notify({
      userIds: [trip.student_id],
      type: 'SIGNAL_LOST',
      title: 'Location sharing interrupted',
      body: 'We have not received your location recently. Please open SmartOutpass and check location permissions.',
      tripId: trip.id,
    });
  }
  return { alerted };
}

/** Student returned (geofence/check-in) but security never scanned ENTRY -> complete after grace. */
async function runAutoComplete(now = new Date()) {
  const s = await settingsSvc.getAll();
  const cutoff = new Date(now.getTime() - s.return_autocomplete_grace_min * 60_000);
  const rows = await db.query(
    "SELECT id FROM trips WHERE status IN ('ACTIVE','OVERDUE') AND returned_at IS NOT NULL AND entry_at IS NULL AND returned_at < ?",
    [cutoff],
  );
  for (const r of rows) await tripSvc.completeTrip(r.id, { at: now, reason: 'AUTO_AFTER_RETURN' });
  return { completed: rows.length };
}

/** Pending requests / unused approved passes whose window has passed -> EXPIRED. */
async function runExpiry(now = new Date()) {
  const pending = await db.query("UPDATE outpass_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expected_return_at < ?", [now]);
  const unused = await db.query(
    `SELECT t.id, t.request_id, o.student_id, o.pass_type FROM trips t JOIN outpass_requests o ON o.id = t.request_id
     WHERE t.status = 'APPROVED' AND t.exit_at IS NULL AND t.window_end < ?`,
    [now],
  );
  let noShow = 0;
  for (const t of unused) {
    if (t.pass_type === 'DAILY') {
      // Missed day of a daily pass: record NO_SHOW (never overdue); the pass itself continues.
      await db.query("UPDATE trips SET status = 'NO_SHOW' WHERE id = ? AND status = 'APPROVED'", [t.id]);
      await tripSvc.recordEvent(t.id, 'NO_SHOW', now);
      await tripSvc.stopTracking(t.id, t.student_id, 'TRIP_CANCELLED');
      noShow++;
      continue;
    }
    await db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", [t.id]);
    await db.query("UPDATE outpass_requests SET status = 'EXPIRED' WHERE id = ?", [t.request_id]);
    await tripSvc.stopTracking(t.id, t.student_id, 'TRIP_CANCELLED');
    emitTo([rooms.user(t.student_id), rooms.staff], 'request:updated', { id: t.request_id, status: 'EXPIRED', tripId: t.id });
  }
  const expiredPasses = await daily.expireSchedules(now);
  return { expiredPending: pending.affectedRows, expiredUnused: unused.length - noShow, dailyNoShow: noShow, expiredPasses };
}

/** Delete location pings older than ping_retention_days, in batches. */
async function runPingRetention(now = new Date()) {
  const days = await settingsSvc.get('ping_retention_days');
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  let deleted = 0;
  for (;;) {
    const res = await db.query('DELETE FROM location_pings WHERE recorded_at < ? LIMIT 5000', [cutoff]);
    deleted += res.affectedRows;
    if (res.affectedRows < 5000) break;
  }
  return { deleted };
}

/** Create today's trips for active daily passes (cron 00:05 IST and on start-up) and expire finished passes. */
async function runDailyPasses(now = new Date()) {
  const created = await daily.generateDailyTrips({ now });
  const expired = await daily.expireSchedules(now);
  return { tripsCreated: created.length, passesExpired: expired };
}

module.exports = { runSignalLostCheck, runAutoComplete, runExpiry, runPingRetention, runDailyPasses };

/**
 * Location ingestion. Enforces (server-side) that tracking is only accepted when
 *   1. trip is ACTIVE/OVERDUE (i.e. after the gate EXIT scan),
 *   2. the student has an active consent for this trip,
 *   3. now is inside the trip window [exit_at, window_end + overrun] — overrun is tracking_overrun_max_min for one-time
 *      trips and daily_pass_tracking_grace_min for a daily pass (each day only inside that day's window).
 * Then stores pings, runs the geofence engine and broadcasts to authorised rooms.
 */
const db = require('../db');
const repo = require('./repo');
const settingsSvc = require('./settings.service');
const tripSvc = require('./trip.service');
const { evaluatePing, nextIntervalSec } = require('./geofence.engine');
const { emitTo, rooms } = require('../realtime');
const { AppError, notFound, forbidden } = require('../utils/errors');
const { iso } = require('../utils/http');

const notAllowed = (reason, message) => new AppError(403, 'TRACKING_NOT_ALLOWED', message, { reason });

/** Pure check used by the route and by tests. */
function trackingDecision({ trip, consent, now, overrunMin }) {
  if (trip.status !== 'ACTIVE' && trip.status !== 'OVERDUE') return { ok: false, reason: 'TRIP_NOT_ACTIVE' };
  if (!consent || consent.revoked_at) return { ok: false, reason: 'NO_CONSENT' };
  const start = new Date(trip.exit_at).getTime();
  const end = new Date(trip.expected_return_at).getTime() + overrunMin * 60_000;
  if (now.getTime() < start || now.getTime() > end) return { ok: false, reason: 'OUTSIDE_TRIP_WINDOW' };
  return { ok: true };
}

const REASON_MESSAGES = {
  TRIP_NOT_ACTIVE: 'Location sharing starts after the gate exit scan and ends when the trip is completed.',
  NO_CONSENT: 'You have not consented to share location for this trip.',
  OUTSIDE_TRIP_WINDOW: 'Location sharing is outside the allowed trip window.',
};

async function getDestinationFence(tripId) {
  const r = await db.one("SELECT * FROM geofences WHERE trip_id = ? AND type = 'DESTINATION' AND is_active = 1 LIMIT 1", [tripId]);
  return r ? repo.serializeFence(r) : null;
}

/**
 * @param {object} user  authenticated student
 * @param {number} tripId
 * @param {Array<{lat,lng,accuracy,speed,battery,timestamp}>} pings
 */
async function ingestPings(user, tripId, pings, now = new Date()) {
  const s = await settingsSvc.getAll();
  const campus = await repo.getCampusFences();
  const destination = await getDestinationFence(tripId);

  const outcome = await db.transaction(async (tx) => {
    const trip = await tx.one(
      `SELECT t.*, o.student_id, t.window_end AS expected_return_at, o.destination_type, o.pass_type, s.name AS student_name, s.roll_no
       FROM trips t JOIN outpass_requests o ON o.id = t.request_id JOIN users s ON s.id = o.student_id
       WHERE t.id = ? FOR UPDATE`,
      [tripId],
    );
    if (!trip) throw notFound('Trip');
    if (trip.student_id !== user.id) throw forbidden('You can only share location for your own trip');
    const consent = await repo.getActiveConsent(tripId, tx);
    const overrunMin = trip.pass_type === 'DAILY' ? s.daily_pass_tracking_grace_min : s.tracking_overrun_max_min;
    const decision = trackingDecision({ trip, consent, now, overrunMin });
    if (!decision.ok) throw notAllowed(decision.reason, REASON_MESSAGES[decision.reason]);

    const exitMs = new Date(trip.exit_at).getTime();
    const valid = pings
      .map((p) => ({ ...p, recorded_at: p.timestamp ? new Date(p.timestamp) : now }))
      .filter((p) => {
        const t = p.recorded_at.getTime();
        return Number.isFinite(t) && t >= exitMs - 60_000 && t <= now.getTime() + 120_000;
      })
      .sort((a, b) => a.recorded_at - b.recorded_at);

    let state = {
      left_campus_at: trip.left_campus_at,
      reached_destination_at: trip.reached_destination_at,
      returned_at: trip.returned_at,
      dest_streak: trip.dest_streak,
      campus_streak: trip.campus_streak,
    };
    const events = [];
    for (const p of valid) {
      await tx.query(
        'INSERT INTO location_pings (trip_id, lat, lng, accuracy, speed, battery, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tripId, p.lat, p.lng, p.accuracy ?? null, p.speed ?? null, p.battery ?? null, p.recorded_at],
      );
      const r = evaluatePing(state, p, {
        campus,
        destination,
        debounce: s.geofence_debounce_count,
        maxAccuracy: s.geofence_max_accuracy_m,
      });
      state = r.state;
      events.push(...r.events);
    }
    if (valid.length) {
      const lastAt = valid[valid.length - 1].recorded_at;
      await tx.query(
        `UPDATE trips SET left_campus_at = ?, reached_destination_at = ?, returned_at = ?, dest_streak = ?, campus_streak = ?,
           last_ping_at = GREATEST(COALESCE(last_ping_at, ?), ?), signal_lost_at = NULL WHERE id = ?`,
        [state.left_campus_at, state.reached_destination_at, state.returned_at, state.dest_streak, state.campus_streak, lastAt, lastAt, tripId],
      );
    }
    return { trip, valid, events };
  });

  const { trip, valid, events } = outcome;
  const last = valid[valid.length - 1];
  if (last) {
    const payload = {
      tripId,
      studentId: trip.student_id,
      studentName: trip.student_name,
      rollNo: trip.roll_no,
      lat: Number(last.lat),
      lng: Number(last.lng),
      accuracy: last.accuracy ?? null,
      speed: last.speed ?? null,
      battery: last.battery ?? null,
      recorded_at: iso(last.recorded_at),
      status: trip.status,
    };
    emitTo([rooms.trip(tripId), rooms.trackingAll], 'trip:location', payload);
  }

  for (const e of events) {
    if (e.type === 'LEFT_CAMPUS') {
      if (await tripSvc.recordEvent(tripId, 'LEFT_CAMPUS', e.at)) tripSvc.broadcastEvent(trip, 'LEFT_CAMPUS', e.at);
    } else if (e.type === 'REACHED_DESTINATION') {
      await tripSvc.onReachedDestination(trip, e.at);
    } else if (e.type === 'RETURNED_CAMPUS') {
      await tripSvc.onReturnedCampus(trip, e.at, 'GEOFENCE');
    }
  }

  return {
    accepted: valid.length,
    events: events.map((e) => e.type),
    next_interval_sec: nextIntervalSec(last || {}, s),
  };
}

module.exports = { ingestPings, trackingDecision, getDestinationFence, REASON_MESSAGES };

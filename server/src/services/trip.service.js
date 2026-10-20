/**
 * Trip lifecycle: status transitions, idempotent events, notifications and realtime broadcasts.
 */
const db = require('../db');
const repo = require('./repo');
const { notify } = require('./notification.service');
const { emitTo, rooms, evictParentsFromTrip } = require('../realtime');
const { iso } = require('../utils/http');

const fmtTime = (d) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

/** Insert a trip event once. Returns true only the first time (so callers notify once). */
async function recordEvent(tripId, type, at = new Date(), data = null, conn = db) {
  const res = await conn.query('INSERT IGNORE INTO trip_events (trip_id, type, occurred_at, data) VALUES (?, ?, ?, ?)', [
    tripId,
    type,
    at,
    data ? JSON.stringify(data) : null,
  ]);
  return res.affectedRows === 1;
}

function broadcastEvent(trip, type, at, data = {}) {
  emitTo([rooms.trip(trip.id), rooms.trackingAll, rooms.staff, rooms.user(trip.student_id)], 'trip:event', {
    tripId: trip.id,
    studentId: trip.student_id,
    type,
    at: iso(at),
    data,
  });
}

function broadcastStatus(trip, status, requestStatus) {
  emitTo([rooms.trip(trip.id), rooms.staff, rooms.user(trip.student_id)], 'trip:status', {
    tripId: trip.id,
    requestId: trip.request_id,
    status,
    requestStatus,
  });
  emitTo(rooms.staff, 'dashboard:refresh', { reason: `trip:${status}` });
}

async function parentIds(studentId) {
  return (await repo.parentsOf(studentId)).map((p) => p.id);
}

async function onDeparted(trip, at) {
  if (!(await recordEvent(trip.id, 'DEPARTED', at))) return;
  broadcastEvent(trip, 'DEPARTED', at);
  broadcastStatus(trip, 'ACTIVE', 'ACTIVE');
  const name = trip.student_name;
  await notify({
    userIds: await parentIds(trip.student_id),
    type: 'DEPARTED',
    title: `${name} has left campus`,
    body: `${name} exited the campus gate at ${fmtTime(at)}. Expected back by ${fmtTime(trip.expected_return_at)}.`,
    tripId: trip.id,
  });
}

async function onReachedDestination(trip, at) {
  if (!(await recordEvent(trip.id, 'REACHED_DESTINATION', at))) return;
  broadcastEvent(trip, 'REACHED_DESTINATION', at);
  const place = trip.destination_type === 'HOME' ? 'home' : 'the destination';
  await notify({
    userIds: [...(await parentIds(trip.student_id)), ...(await repo.wardensFor(trip.student_id))],
    type: 'REACHED_DESTINATION',
    title: `${trip.student_name} reached ${place}`,
    body: `${trip.student_name} arrived at ${place} at ${fmtTime(at)}.`,
    tripId: trip.id,
  });
}

async function onReturnedCampus(trip, at, source = 'GEOFENCE') {
  if (!(await recordEvent(trip.id, 'RETURNED_CAMPUS', at, { source }))) return;
  broadcastEvent(trip, 'RETURNED_CAMPUS', at, { source });
  await notify({
    userIds: [...(await parentIds(trip.student_id)), ...(await repo.wardensFor(trip.student_id))],
    type: 'RETURNED_CAMPUS',
    title: `${trip.student_name} reached college`,
    body: `${trip.student_name} is back on campus (${fmtTime(at)}).`,
    tripId: trip.id,
    sms: true,
  });
}

/** Mark returned_at (if not yet) — used by manual check-in and ENTRY scan. */
async function markReturned(tripId, at, source) {
  const res = await db.query('UPDATE trips SET returned_at = ? WHERE id = ? AND returned_at IS NULL', [at, tripId]);
  if (res.affectedRows === 1) {
    const trip = await repo.getTripRaw(tripId);
    await onReturnedCampus(trip, at, source);
  }
}

/** Stop tracking for a trip: revoke open consents, tell the student app and evict parents. */
async function stopTracking(tripId, studentId, reason) {
  const revokeReason = reason === 'CONSENT_REVOKED' ? 'USER' : reason;
  const res = await db.query('UPDATE tracking_consents SET revoked_at = ?, revoke_reason = ? WHERE trip_id = ? AND revoked_at IS NULL', [
    new Date(),
    revokeReason,
    tripId,
  ]);
  emitTo([rooms.trip(tripId), rooms.user(studentId)], 'tracking:stop', { tripId, reason });
  await evictParentsFromTrip(tripId);
  return res.affectedRows;
}

async function completeTrip(tripId, { at = new Date(), reason = 'ENTRY_SCAN' } = {}) {
  const trip = await repo.getTripRaw(tripId);
  if (!trip || trip.status === 'COMPLETED' || trip.status === 'CANCELLED') return false;
  await db.transaction(async (tx) => {
    await tx.query("UPDATE trips SET status = 'COMPLETED', completed_at = ?, returned_at = COALESCE(returned_at, ?) WHERE id = ?", [
      at,
      at,
      tripId,
    ]);
    await tx.query("UPDATE outpass_requests SET status = 'COMPLETED' WHERE id = ?", [trip.request_id]);
    await recordEvent(tripId, 'COMPLETED', at, { reason }, tx);
  });
  if (!trip.returned_at) await onReturnedCampus(trip, at, reason);
  await stopTracking(tripId, trip.student_id, 'TRIP_COMPLETED');
  broadcastEvent(trip, 'COMPLETED', at, { reason });
  broadcastStatus(trip, 'COMPLETED', 'COMPLETED');
  const late = new Date(at) > new Date(trip.expected_return_at);
  await notify({
    userIds: [trip.student_id],
    type: 'TRIP_COMPLETED',
    title: 'Trip completed',
    body: late ? 'Welcome back. Your return was recorded after the expected time.' : 'Welcome back! Your outpass is now closed.',
    tripId,
  });
  return true;
}

module.exports = {
  recordEvent,
  broadcastEvent,
  broadcastStatus,
  onDeparted,
  onReachedDestination,
  onReturnedCampus,
  markReturned,
  stopTracking,
  completeTrip,
  fmtTime,
  parentIds,
};

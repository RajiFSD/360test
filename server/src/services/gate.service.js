/**
 * Gate verification and EXIT/ENTRY recording.
 * Single-use per direction is guaranteed by conditional UPDATEs (exit_at IS NULL / entry_at IS NULL),
 * so two guards scanning the same QR simultaneously can't both record an EXIT.
 */
const db = require('../db');
const config = require('../config');
const repo = require('./repo');
const settings = require('./settings.service');
const tripSvc = require('./trip.service');
const { verifyQrSignature, evaluateScan, QR_ERRORS } = require('../utils/qr');
const { unprocessable, notFound, conflict } = require('../utils/errors');

async function logGate({ tripId = null, guardId, type = null, result, method = 'QR', note = null }) {
  const r = await db.query('INSERT INTO gate_logs (trip_id, guard_id, type, scanned_at, result, method, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    tripId, guardId, type, new Date(), result, method, note,
  ]);
  return { id: r.insertId, trip_id: tripId, guard_id: guardId, type, scanned_at: new Date().toISOString(), result, method, note };
}

async function context(tripId) {
  const trip = await repo.getTrip(tripId);
  if (!trip) return null;
  const outpass = await repo.getOutpass(trip.request_id);
  return { trip, outpass, student: trip.student };
}

/** Throws 422 QR_* (logging the rejection) or returns { action, raw, ...context }. */
async function verifyToken(token, guardId, { log = true } = {}) {
  const sig = verifyQrSignature(token, config.qrSecret);
  const fail = async (code, tripId) => {
    const ctx = tripId ? await context(tripId) : null;
    if (log) await logGate({ tripId: ctx ? tripId : null, guardId, result: `REJECTED_${code}` });
    throw unprocessable(code, QR_ERRORS[code], ctx ? { student: ctx.student, trip: ctx.trip } : undefined);
  };
  if (!sig.ok) return fail(sig.code, Number.isInteger(sig.payload?.tid) ? sig.payload.tid : null);
  const raw = await repo.getTripRaw(sig.payload.tid);
  if (!raw) return fail('QR_INVALID', null);
  const decision = evaluateScan({
    payload: sig.payload,
    trip: raw,
    request: raw,
    exitEarlyMin: await settings.get('qr_exit_early_min'),
  });
  if (!decision.ok) return fail(decision.code, raw.id);
  return { action: decision.action, raw, ...(await context(raw.id)) };
}

/** Record an EXIT or ENTRY for a trip. */
async function record(raw, action, guardId, method = 'QR', note = null) {
  const now = new Date();
  if (action === 'EXIT') {
    const r = await db.query(
      "UPDATE trips SET status = 'ACTIVE', exit_at = ?, exit_guard_id = ? WHERE id = ? AND exit_at IS NULL AND status = 'APPROVED'",
      [now, guardId, raw.id],
    );
    if (!r.affectedRows) {
      await logGate({ tripId: raw.id, guardId, type: 'EXIT', result: 'REJECTED_QR_ALREADY_USED', method });
      throw unprocessable('QR_ALREADY_USED', 'Exit has already been recorded for this pass.', await context(raw.id));
    }
    await db.query("UPDATE outpass_requests SET status = 'ACTIVE' WHERE id = ?", [raw.request_id]);
    const gateLog = await logGate({ tripId: raw.id, guardId, type: 'EXIT', result: 'OK', method, note });
    await tripSvc.onDeparted({ ...raw, status: 'ACTIVE' }, now);
    return { action, gate_log: gateLog, ...(await context(raw.id)) };
  }
  const r = await db.query(
    "UPDATE trips SET entry_at = ?, entry_guard_id = ? WHERE id = ? AND entry_at IS NULL AND exit_at IS NOT NULL AND status IN ('ACTIVE','OVERDUE')",
    [now, guardId, raw.id],
  );
  if (!r.affectedRows) {
    await logGate({ tripId: raw.id, guardId, type: 'ENTRY', result: 'REJECTED_QR_ALREADY_USED', method });
    throw unprocessable('QR_ALREADY_USED', 'Entry has already been recorded for this pass.', await context(raw.id));
  }
  const late = now > new Date(raw.expected_return_at);
  const gateLog = await logGate({ tripId: raw.id, guardId, type: 'ENTRY', result: late ? 'OK_LATE' : 'OK', method, note });
  await tripSvc.completeTrip(raw.id, { at: now, reason: method === 'MANUAL' ? 'MANUAL_ENTRY' : 'ENTRY_SCAN' });
  return { action, gate_log: gateLog, ...(await context(raw.id)) };
}

/** Fallback when the student's phone is unavailable. */
async function lookupByRoll(rollNo) {
  const student = await db.one("SELECT id FROM users WHERE roll_no = ? AND role = 'student'", [rollNo.toUpperCase()]);
  if (!student) throw notFound('Student');
  const user = await repo.getUser(student.id);
  const summary = { id: user.id, name: user.name, roll_no: user.roll_no, photo_url: user.photo_url, phone: user.phone, department: user.department, hostel: user.hostel };
  const { items } = await repo.listTrips("o.student_id = ? AND t.status IN ('APPROVED','ACTIVE','OVERDUE')", [student.id], {
    limit: 1,
    order: "FIELD(t.status, 'OVERDUE','ACTIVE','APPROVED'), o.depart_at",
  });
  const trip = items[0] || null;
  const outpass = trip ? await repo.getOutpass(trip.request_id) : null;
  let action = null;
  if (trip) action = trip.exit_at ? (trip.entry_at ? null : 'ENTRY') : 'EXIT';
  return { student: summary, trip, outpass, action };
}

async function manual(tripId, action, guardId, note) {
  const raw = await repo.getTripRaw(tripId);
  if (!raw) throw notFound('Trip');
  if (action === 'EXIT') {
    if (raw.status !== 'APPROVED' || raw.exit_at) throw conflict('Exit can only be recorded for an approved pass that has not been used');
    const earliest = new Date(raw.depart_at).getTime() - (await settings.get('qr_exit_early_min')) * 60_000;
    if (Date.now() < earliest || Date.now() > new Date(raw.expected_return_at).getTime()) {
      throw unprocessable('OUTSIDE_TIME_WINDOW', QR_ERRORS.OUTSIDE_TIME_WINDOW, await context(tripId));
    }
  } else if (!['ACTIVE', 'OVERDUE'].includes(raw.status) || raw.entry_at) {
    throw conflict('Entry can only be recorded for a student who is out on an active trip');
  }
  return record(raw, action, guardId, 'MANUAL', note);
}

module.exports = { verifyToken, record, lookupByRoll, manual, logGate };

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
const daily = require('./daily.service');
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
  const ctx = { trip, outpass, student: trip.student };
  if (trip.pass_type === 'DAILY') {
    const sc = await daily.getSchedule(trip.request_id);
    if (sc) {
      const { day, total } = daily.dayNumber(sc, trip.trip_date);
      // "Daily pass, day N of M" + today's window for the guard's screen.
      ctx.daily = { day, total, trip_date: trip.trip_date, window_start: trip.depart_at, window_end: trip.expected_return_at, schedule_status: sc.status };
    }
  }
  return ctx;
}

/**
 * Daily-pass checks before an EXIT: the pass must be ACTIVE and the QR must be today's.
 * A trip that has already exited may always come back in (ENTRY), even if the pass was paused meanwhile.
 */
async function dailyExitProblem(raw, now) {
  if (raw.pass_type !== 'DAILY' || raw.exit_at) return null;
  const sc = await daily.getSchedule(raw.request_id);
  if (sc?.status === 'PAUSED') return 'PASS_PAUSED';
  if (sc?.status === 'CANCELLED' || raw.request_status === 'CANCELLED') return 'PASS_REVOKED';
  if (sc?.status === 'EXPIRED') return 'PASS_EXPIRED';
  if (daily.toDateStr(raw.trip_date) !== daily.localDate(now) || raw.status === 'NO_SHOW') return 'NOT_SCHEDULED_TODAY';
  return null;
}

/** Throws 422 QR_* (logging the rejection) or returns { action, raw, ...context }. */
async function verifyToken(token, guardId, { log = true, now = new Date() } = {}) {
  const sig = verifyQrSignature(token, config.qrSecret, now);
  const fail = async (code, tripId) => {
    const ctx = tripId ? await context(tripId) : null;
    if (log) await logGate({ tripId: ctx ? tripId : null, guardId, result: `REJECTED_${code}` });
    throw unprocessable(code, QR_ERRORS[code], ctx ? { student: ctx.student, trip: ctx.trip, daily: ctx.daily } : undefined);
  };
  if (!sig.ok) return fail(sig.code, Number.isInteger(sig.payload?.tid) ? sig.payload.tid : null);
  const raw = await repo.getTripRaw(sig.payload.tid);
  if (!raw) return fail('QR_INVALID', null);
  const dailyProblem = await dailyExitProblem(raw, now);
  if (dailyProblem) return fail(dailyProblem, raw.id);
  const decision = evaluateScan({
    payload: sig.payload,
    trip: raw,
    request: raw, // depart_at / expected_return_at are this trip's own window
    now,
    exitEarlyMin: await settings.get(raw.pass_type === 'DAILY' ? 'daily_pass_qr_grace_min' : 'qr_exit_early_min'),
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
    // A daily pass stays APPROVED as a whole; only that day's trip becomes ACTIVE.
    await db.query("UPDATE outpass_requests SET status = 'ACTIVE' WHERE id = ? AND pass_type = 'ONE_TIME'", [raw.request_id]);
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
  await daily.generateDailyTrips({ studentId: student.id }); // lazily create today's daily-pass trip
  // Daily passes: only today's trip (or one already out) is relevant at the gate.
  const { items } = await repo.listTrips(
    "o.student_id = ? AND t.status IN ('APPROVED','ACTIVE','OVERDUE') AND (o.pass_type = 'ONE_TIME' OR t.status <> 'APPROVED' OR t.trip_date = ?)",
    [student.id, daily.localDate()],
    {
    limit: 1,
    order: "FIELD(t.status, 'OVERDUE','ACTIVE','APPROVED'), o.depart_at",
  });
  const trip = items[0] || null;
  const outpass = trip ? await repo.getOutpass(trip.request_id) : null;
  let action = null;
  if (trip) action = trip.exit_at ? (trip.entry_at ? null : 'ENTRY') : 'EXIT';
  const ctx = trip ? await context(trip.id) : null;
  return { student: summary, trip, outpass, action, daily: ctx?.daily || null };
}

async function manual(tripId, action, guardId, note) {
  const raw = await repo.getTripRaw(tripId);
  if (!raw) throw notFound('Trip');
  if (action === 'EXIT') {
    const dailyProblem = await dailyExitProblem(raw, new Date());
    if (dailyProblem) throw unprocessable(dailyProblem, QR_ERRORS[dailyProblem], await context(tripId));
    if (raw.status !== 'APPROVED' || raw.exit_at) throw conflict('Exit can only be recorded for an approved pass that has not been used');
    const early = await settings.get(raw.pass_type === 'DAILY' ? 'daily_pass_qr_grace_min' : 'qr_exit_early_min');
    const earliest = new Date(raw.depart_at).getTime() - early * 60_000;
    if (Date.now() < earliest || Date.now() > new Date(raw.expected_return_at).getTime()) {
      throw unprocessable('OUTSIDE_TIME_WINDOW', QR_ERRORS.OUTSIDE_TIME_WINDOW, await context(tripId));
    }
  } else if (!['ACTIVE', 'OVERDUE'].includes(raw.status) || raw.entry_at) {
    throw conflict('Entry can only be recorded for a student who is out on an active trip');
  }
  return record(raw, action, guardId, 'MANUAL', note);
}

module.exports = { verifyToken, record, lookupByRoll, manual, logGate };

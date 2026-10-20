const express = require('express');
const { z } = require('zod');
const db = require('../db');
const repo = require('../services/repo');
const ai = require('../services/ai');
const settings = require('../services/settings.service');
const tripSvc = require('../services/trip.service');
const daily = require('../services/daily.service');
const { notify } = require('../services/notification.service');
const { emitTo, rooms } = require('../realtime');
const { authenticate, requireRole, isStaff } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, forbidden, conflict, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination, csvList } = require('../utils/http');
const { newJti } = require('../utils/qr');

const router = express.Router();
router.use(authenticate());

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'EXPIRED'];
const CATEGORIES = ['HOME_VISIT', 'MEDICAL', 'FAMILY_EVENT', 'ACADEMIC', 'PERSONAL', 'SHOPPING', 'OTHER'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    pass_type: z.literal('ONE_TIME').optional(),
    reason: z.string().trim().min(3).max(500),
    reason_category: z.enum(CATEGORIES),
    destination_type: z.enum(['HOME', 'OTHER']),
    dest_address: z.string().trim().min(3).max(500),
    dest_lat: z.coerce.number().min(-90).max(90),
    dest_lng: z.coerce.number().min(-180).max(180),
    depart_at: z.coerce.date(),
    expected_return_at: z.coerce.date(),
    attachment_url: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.expected_return_at > v.depart_at, { message: 'expected_return_at must be after depart_at', path: ['expected_return_at'] })
  .refine((v) => v.depart_at.getTime() >= Date.now() - 15 * 60_000, { message: 'Departure cannot be in the past', path: ['depart_at'] })
  .refine((v) => v.expected_return_at - v.depart_at <= 30 * 86_400_000, { message: 'Outpass cannot exceed 30 days', path: ['expected_return_at'] });

const dailySchema = z
  .object({
    pass_type: z.literal('DAILY'),
    reason: z.string().trim().min(3).max(500),
    reason_category: z.enum(daily.DAILY_CATEGORIES),
    dest_name: z.string().trim().min(2, 'Enter the place name').max(160),
    dest_address: z.string().trim().min(3).max(500),
    dest_lat: z.coerce.number().min(-90).max(90),
    dest_lng: z.coerce.number().min(-180).max(180),
    start_date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    end_date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    days_of_week: z.array(z.enum(daily.DAYS)).min(1, 'Choose at least one day').max(7),
    depart_time: z.string().regex(TIME_RE, 'Use HH:MM (24-hour)'),
    return_time: z.string().regex(TIME_RE, 'Use HH:MM (24-hour)'),
    attachment_url: z.string().trim().max(500).optional().nullable(),
    consent: z.boolean().optional(),
  })
  .refine((v) => v.return_time > v.depart_time, { message: 'Return time must be after departure time (same day)', path: ['return_time'] })
  .refine((v) => v.end_date >= v.start_date, { message: 'End date must be on or after the start date', path: ['end_date'] })
  .refine((v) => v.start_date >= daily.localDate(), { message: 'Start date cannot be in the past', path: ['start_date'] });

/** Row-level scope for listing/reading outpasses. */
async function scopeFor(user) {
  if (user.role === 'student') return { where: 'o.student_id = ?', params: [user.id] };
  if (user.role === 'parent') {
    const ids = await repo.linkedStudentIds(user.id);
    return ids.length ? { where: 'o.student_id IN (?)', params: [ids] } : { where: '1=0', params: [] };
  }
  if (isStaff(user) || user.role === 'security') return { where: '1=1', params: [] };
  return { where: '1=0', params: [] };
}

async function loadScoped(user, id) {
  const op = await repo.getOutpass(id);
  if (!op) throw notFound('Outpass');
  const scope = await scopeFor(user);
  const allowed = await db.one(`SELECT o.id FROM outpass_requests o WHERE o.id = ? AND ${scope.where}`, [id, ...scope.params]);
  if (!allowed) throw forbidden();
  return op;
}

/** A student who is currently out (any pass) cannot request another outpass. */
async function assertNotOut(studentId) {
  const out = await db.one(
    `SELECT t.id FROM trips t JOIN outpass_requests o ON o.id = t.request_id
     WHERE o.student_id = ? AND t.status IN ('ACTIVE','OVERDUE') LIMIT 1`,
    [studentId],
  );
  if (out) throw conflict('You already have an active trip. Return to campus before requesting a new outpass.');
}

async function announceNew(req, op) {
  await audit(req, 'OUTPASS_CREATED', 'outpass', op.id, { risk_score: op.risk_score, pass_type: op.pass_type });
  emitTo(rooms.staff, 'request:new', op);
  emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:new' });
  const what = op.pass_type === 'DAILY' ? 'daily pass' : 'outpass';
  await notify({
    userIds: await repo.wardensFor(op.student_id),
    type: 'REQUEST_SUBMITTED',
    title: `New ${what}: ${op.student.name}${op.risk_level === 'HIGH' ? ' (HIGH RISK)' : ''}`,
    body: `${op.reason_category.replace('_', ' ').toLowerCase()} — ${op.dest_address}. Risk ${op.risk_score ?? '–'}/100.`,
    data: { outpassId: op.id },
  });
}

async function createDailyPass(req, b) {
  const s = await settings.getAll();
  const span = (new Date(`${b.end_date}T00:00:00Z`) - new Date(`${b.start_date}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > s.daily_pass_max_days) {
    throw badRequest(`A daily pass can cover at most ${s.daily_pass_max_days} days`, [{ path: 'end_date', message: `At most ${s.daily_pass_max_days} days` }]);
  }
  const dates = daily.scheduledDates(b);
  if (!dates.length) throw badRequest('No selected weekday falls between the start and end dates', [{ path: 'days_of_week', message: 'No matching days in this range' }]);

  const today = daily.localDate();
  const open = await db.query(
    `SELECT sc.start_date, sc.end_date FROM outpass_schedules sc JOIN outpass_requests o ON o.id = sc.request_id
     WHERE o.student_id = ? AND o.pass_type = 'DAILY' AND o.status IN ('PENDING','APPROVED')
       AND sc.status IN ('ACTIVE','PAUSED') AND sc.end_date >= ?`,
    [req.user.id, today],
  );
  if (open.some((p) => daily.toDateStr(p.start_date) <= b.end_date && daily.toDateStr(p.end_date) >= b.start_date)) {
    throw conflict('These dates overlap with another daily pass you already have.');
  }
  if (open.length >= s.daily_pass_max_per_student) {
    throw conflict(`You can have at most ${s.daily_pass_max_per_student} active daily pass${s.daily_pass_max_per_student === 1 ? '' : 'es'}.`);
  }

  // Request-level window = first day's departure .. last day's return. The AI risk uses a typical day (the first one).
  const firstStart = daily.localToUtc(dates[0], b.depart_time);
  const firstEnd = daily.localToUtc(dates[0], b.return_time);
  const lastEnd = daily.localToUtc(dates[dates.length - 1], b.return_time);
  let risk = null;
  try {
    risk = await ai.predict({
      student_id: req.user.id, reason_category: b.reason_category, destination_type: 'OTHER',
      dest_lat: b.dest_lat, dest_lng: b.dest_lng, depart_at: firstStart, expected_return_at: firstEnd,
    });
  } catch (err) {
    console.warn('[outpass] risk prediction failed:', err.message);
  }
  const id = await db.transaction(async (tx) => {
    const r = await tx.query(
      `INSERT INTO outpass_requests (student_id, pass_type, reason, reason_category, destination_type, dest_address, dest_lat, dest_lng,
         depart_at, expected_return_at, attachment_url, risk_score, delay_probability, predicted_delay_min, risk_reasons)
       VALUES (?, 'DAILY', ?, ?, 'OTHER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, b.reason, b.reason_category, b.dest_address, b.dest_lat, b.dest_lng, firstStart, lastEnd, b.attachment_url || null,
        risk?.risk_score ?? null, risk?.delay_probability ?? null, risk?.expected_delay_min ?? null, risk ? JSON.stringify(risk.reasons) : null,
      ],
    );
    await tx.query(
      `INSERT INTO outpass_schedules (request_id, dest_name, start_date, end_date, days_of_week, depart_time, return_time, consent_granted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.insertId, b.dest_name, b.start_date, b.end_date, b.days_of_week.join(','), b.depart_time, b.return_time, b.consent ? new Date() : null],
    );
    return r.insertId;
  });
  if (b.consent) await audit(req, 'PASS_CONSENT_GRANTED', 'outpass', id, { scope: 'DAILY_WINDOWS' });
  return id;
}

router.post(
  '/',
  requireRole('student'),
  (req, res, next) => validate(req.body?.pass_type === 'DAILY' ? dailySchema : createSchema)(req, res, next),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await assertNotOut(req.user.id);

    if (b.pass_type === 'DAILY') {
      const op = await repo.getOutpass(await createDailyPass(req, b));
      await announceNew(req, op);
      return ok(res, op, undefined, 201);
    }

    let risk = null;
    try {
      risk = await ai.predict({ ...b, student_id: req.user.id });
    } catch (err) {
      console.warn('[outpass] risk prediction failed:', err.message);
    }
    const r = await db.query(
      `INSERT INTO outpass_requests (student_id, reason, reason_category, destination_type, dest_address, dest_lat, dest_lng,
         depart_at, expected_return_at, attachment_url, risk_score, delay_probability, predicted_delay_min, risk_reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, b.reason, b.reason_category, b.destination_type, b.dest_address, b.dest_lat, b.dest_lng, b.depart_at,
        b.expected_return_at, b.attachment_url || null, risk?.risk_score ?? null, risk?.delay_probability ?? null,
        risk?.expected_delay_min ?? null, risk ? JSON.stringify(risk.reasons) : null,
      ],
    );
    const op = await repo.getOutpass(r.insertId);
    await announceNew(req, op);
    ok(res, op, undefined, 201);
  }),
);

router.get(
  '/',
  requireRole('student', 'parent', 'warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query);
    const scope = await scopeFor(req.user);
    const where = [scope.where];
    const params = [...scope.params];
    const statuses = csvList(req.query.status, STATUSES);
    if (statuses.length) {
      where.push('o.status IN (?)');
      params.push(statuses);
    }
    const passType = String(req.query.pass_type || '').toUpperCase();
    if (passType === 'DAILY' || passType === 'ONE_TIME') {
      where.push('o.pass_type = ?');
      params.push(passType);
    }
    if (req.query.student_id) {
      where.push('o.student_id = ?');
      params.push(Number(req.query.student_id));
    }
    if (req.query.q) {
      const q = `%${String(req.query.q).trim()}%`;
      where.push('(s.name LIKE ? OR s.roll_no LIKE ? OR o.reason LIKE ? OR o.dest_address LIKE ?)');
      params.push(q, q, q, q);
    }
    if (req.query.from) {
      where.push('o.created_at >= ?');
      params.push(new Date(req.query.from));
    }
    if (req.query.to) {
      where.push('o.created_at <= ?');
      params.push(new Date(req.query.to));
    }
    const risk = String(req.query.risk_level || '').toUpperCase();
    if (risk === 'HIGH') where.push('o.risk_score >= 65');
    else if (risk === 'MEDIUM') where.push('o.risk_score >= 35 AND o.risk_score < 65');
    else if (risk === 'LOW') where.push('o.risk_score < 35');
    const order = statuses.length === 1 && statuses[0] === 'PENDING' ? 'o.depart_at ASC' : 'o.created_at DESC';
    const { items, total } = await repo.listOutpasses(where.join(' AND '), params, { limit, offset, order });
    ok(res, items, { page, pageSize, total });
  }),
);

/** Staff: daily passes with attendance (default: running = ACTIVE/PAUSED and approved). */
router.get(
  '/daily',
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query, { defaultSize: 50 });
    const status = String(req.query.status || 'RUNNING').toUpperCase();
    const where = ["o.pass_type = 'DAILY'"];
    const params = [];
    if (status === 'RUNNING') where.push("o.status = 'APPROVED' AND sc.status IN ('ACTIVE','PAUSED')");
    else if (['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'].includes(status)) {
      where.push('sc.status = ?');
      params.push(status);
    }
    if (req.query.q) {
      const q = `%${String(req.query.q).trim()}%`;
      where.push('(s.name LIKE ? OR s.roll_no LIKE ? OR sc.dest_name LIKE ?)');
      params.push(q, q, q);
    }
    const { items, total } = await repo.listOutpasses(where.join(' AND '), params, { limit, offset, order: 'sc.start_date DESC, o.id DESC' });
    const stats = await daily.passStats(items.map((i) => i.id));
    ok(res, items.map((i) => ({ ...i, schedule: { ...i.schedule, stats: stats.get(i.id) || null } })), { page, pageSize, total });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    // Lazily create today's trip when the owner opens a running daily pass.
    if (req.user.role === 'student') await daily.generateDailyTrips({ requestId: id, studentId: req.user.id });
    // Outpass objects never carry location data, so the same shape is safe for parents.
    const op = await loadScoped(req.user, id);
    const extra = op.trip ? { gate_logs: await repo.getGateLogs(op.trip.id), events: await repo.getTripEvents(op.trip.id) } : { gate_logs: [], events: [] };
    if (op.pass_type === 'DAILY' && op.schedule) {
      op.schedule.stats = (await daily.passStats([id])).get(id) || null;
      if (op.trip) op.schedule.today = daily.dayNumber(op.schedule, op.trip.trip_date);
    }
    ok(res, { ...op, ...extra });
  }),
);

/** Cancel today's not-yet-used trip of a daily pass (a trip already out finishes normally). */
async function cancelTodaysUnusedTrip(requestId, studentId) {
  const t = await db.one(
    "SELECT id FROM trips WHERE request_id = ? AND trip_date = ? AND status = 'APPROVED' AND exit_at IS NULL",
    [requestId, daily.localDate()],
  );
  if (!t) return null;
  await db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", [t.id]);
  await tripSvc.stopTracking(t.id, studentId, 'TRIP_CANCELLED');
  return t.id;
}

router.post(
  '/:id/cancel',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadScoped(req.user, id);
    if (op.pass_type === 'DAILY') {
      // Student cancels the whole pass: future days only; today's trip, if already out, finishes normally.
      if (!['PENDING', 'APPROVED'].includes(op.status)) throw conflict('Only a pending or running daily pass can be cancelled');
      await db.query("UPDATE outpass_requests SET status = 'CANCELLED' WHERE id = ?", [id]);
      await db.query("UPDATE outpass_schedules SET status = 'CANCELLED', status_changed_by = ?, status_changed_at = ?, status_note = 'Cancelled by student' WHERE request_id = ?", [
        req.user.id, new Date(), id,
      ]);
      const tripId = await cancelTodaysUnusedTrip(id, req.user.id);
      await audit(req, 'DAILY_PASS_CANCELLED', 'outpass', id, { tripId });
      emitTo([rooms.staff, rooms.user(req.user.id)], 'request:updated', { id, status: 'CANCELLED', remarks: op.remarks, reviewed_by: op.reviewed_by, tripId });
      return ok(res, await repo.getOutpass(id));
    }
    if (!['PENDING', 'APPROVED'].includes(op.status) || op.trip?.exit_at) throw conflict('Only pending or not-yet-used outpasses can be cancelled');
    await db.query("UPDATE outpass_requests SET status = 'CANCELLED' WHERE id = ?", [id]);
    if (op.trip) {
      await db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", [op.trip.id]);
      await tripSvc.stopTracking(op.trip.id, req.user.id, 'TRIP_CANCELLED');
    }
    await audit(req, 'OUTPASS_CANCELLED', 'outpass', id);
    emitTo([rooms.staff, rooms.user(req.user.id)], 'request:updated', { id, status: 'CANCELLED', remarks: op.remarks, reviewed_by: op.reviewed_by, tripId: op.trip?.id ?? null });
    ok(res, await repo.getOutpass(id));
  }),
);

/** Owner student or staff may pause/resume a running daily pass. Only staff may revoke. */
async function loadDailyForChange(req, id) {
  const op = await loadScoped(req.user, id);
  if (op.pass_type !== 'DAILY' || !op.schedule) throw conflict('This is not a daily pass');
  if (req.user.role === 'student' && op.student_id !== req.user.id) throw forbidden();
  if (!isStaff(req.user) && req.user.role !== 'student') throw forbidden();
  if (op.status !== 'APPROVED') throw conflict(`This pass is ${op.status}`);
  return op;
}

async function tellStudent(op, title, body) {
  await notify({ userIds: [op.student_id], type: 'MANUAL_NOTICE', title, body, data: { outpassId: op.id } });
}

router.post(
  '/:id/pause',
  validate(z.object({ note: z.string().trim().max(500).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadDailyForChange(req, id);
    if (op.schedule.status !== 'ACTIVE') throw conflict(`This pass is ${op.schedule.status}`);
    await db.query("UPDATE outpass_schedules SET status = 'PAUSED', status_changed_by = ?, status_changed_at = ?, status_note = ? WHERE request_id = ?", [
      req.user.id, new Date(), req.body.note || null, id,
    ]);
    const tripId = await cancelTodaysUnusedTrip(id, op.student_id);
    await audit(req, 'DAILY_PASS_PAUSED', 'outpass', id, { tripId, note: req.body.note });
    if (req.user.role !== 'student') await tellStudent(op, 'Daily pass paused', `Your daily pass to ${op.schedule.dest_name} was paused${req.body.note ? `: "${req.body.note}"` : '.'}`);
    emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: op.status, tripId });
    ok(res, await repo.getOutpass(id));
  }),
);

router.post(
  '/:id/resume',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadDailyForChange(req, id);
    if (op.schedule.status !== 'PAUSED') throw conflict(`This pass is ${op.schedule.status}`);
    await db.query("UPDATE outpass_schedules SET status = 'ACTIVE', status_changed_by = ?, status_changed_at = ?, status_note = NULL WHERE request_id = ?", [
      req.user.id, new Date(), id,
    ]);
    // Re-open today's trip if it was cancelled by the pause (new QR id; consent re-applied from the pass).
    const today = await db.one(
      "SELECT id FROM trips WHERE request_id = ? AND trip_date = ? AND status = 'CANCELLED' AND exit_at IS NULL",
      [id, daily.localDate()],
    );
    if (today) {
      await db.query("UPDATE trips SET status = 'APPROVED', qr_token_id = ? WHERE id = ?", [newJti(), today.id]);
      const sc = await daily.getSchedule(id);
      if (sc.consent_granted_at && !sc.consent_revoked_at) {
        await db.query("INSERT INTO tracking_consents (trip_id, student_id, scope, consent_text, granted_at) VALUES (?, ?, 'TRIP_LOCATION', ?, ?)", [
          today.id, op.student_id, daily.DAILY_CONSENT_TEXT, new Date(),
        ]);
      }
    } else {
      await daily.generateDailyTrips({ requestId: id });
    }
    await audit(req, 'DAILY_PASS_RESUMED', 'outpass', id);
    if (req.user.role !== 'student') await tellStudent(op, 'Daily pass resumed', `Your daily pass to ${op.schedule.dest_name} is active again.`);
    emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: op.status });
    ok(res, await repo.getOutpass(id));
  }),
);

router.post(
  '/:id/revoke',
  requireRole('warden', 'faculty', 'admin'),
  validate(z.object({ remarks: z.string().trim().min(3, 'Give a reason for revoking').max(500) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadDailyForChange(req, id);
    await db.query("UPDATE outpass_requests SET status = 'CANCELLED', remarks = ? WHERE id = ?", [req.body.remarks, id]);
    await db.query("UPDATE outpass_schedules SET status = 'CANCELLED', status_changed_by = ?, status_changed_at = ?, status_note = ? WHERE request_id = ?", [
      req.user.id, new Date(), req.body.remarks, id,
    ]);
    const tripId = await cancelTodaysUnusedTrip(id, op.student_id);
    await audit(req, 'DAILY_PASS_REVOKED', 'outpass', id, { tripId, remarks: req.body.remarks });
    await tellStudent(op, 'Daily pass revoked', `Your daily pass to ${op.schedule.dest_name} was revoked: "${req.body.remarks}"`);
    emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: 'CANCELLED', remarks: req.body.remarks, tripId });
    ok(res, await repo.getOutpass(id));
  }),
);

/** Pass-level consent: covers only the scheduled daily windows; each day's trip gets its own consent record. */
router.post(
  '/:id/consent',
  requireRole('student'),
  validate(z.object({ accept: z.literal(true) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadScoped(req.user, id);
    if (op.pass_type !== 'DAILY') throw conflict('Use the trip consent for one-time outpasses');
    if (!['PENDING', 'APPROVED'].includes(op.status)) throw conflict(`This pass is ${op.status}`);
    const now = new Date();
    await db.query('UPDATE outpass_schedules SET consent_granted_at = ?, consent_revoked_at = NULL WHERE request_id = ?', [now, id]);
    if (op.trip && ['APPROVED', 'ACTIVE', 'OVERDUE'].includes(op.trip.status) && !(await repo.getActiveConsent(op.trip.id))) {
      await db.query("INSERT INTO tracking_consents (trip_id, student_id, scope, consent_text, granted_at, ip, user_agent) VALUES (?, ?, 'TRIP_LOCATION', ?, ?, ?, ?)", [
        op.trip.id, req.user.id, daily.DAILY_CONSENT_TEXT, now, req.ip, String(req.headers['user-agent'] || '').slice(0, 255),
      ]);
    }
    await audit(req, 'PASS_CONSENT_GRANTED', 'outpass', id, { scope: 'DAILY_WINDOWS' });
    ok(res, await repo.getOutpass(id));
  }),
);

router.delete(
  '/:id/consent',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadScoped(req.user, id);
    if (op.pass_type !== 'DAILY') throw conflict('Use the trip consent for one-time outpasses');
    await db.query('UPDATE outpass_schedules SET consent_revoked_at = ? WHERE request_id = ? AND consent_revoked_at IS NULL', [new Date(), id]);
    if (op.trip) await tripSvc.stopTracking(op.trip.id, req.user.id, 'CONSENT_REVOKED');
    await audit(req, 'PASS_CONSENT_REVOKED', 'outpass', id);
    ok(res, await repo.getOutpass(id));
  }),
);

const DAY_LABEL = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const scheduleText = (sc) =>
  `${daily.DAYS.filter((d) => String(sc.days_of_week).includes(d)).map((d) => DAY_LABEL[d]).join(', ')} ${String(sc.depart_time).slice(0, 5)}–${String(sc.return_time).slice(0, 5)}, ${daily.toDateStr(sc.start_date)} to ${daily.toDateStr(sc.end_date)}`;

/** Approve one request. One-time: creates its trip now. Daily: activates the schedule; trips are created per day. */
async function approveOne(req, id, remarks) {
  const now = new Date();
  const radius = await settings.get('destination_radius_m');
  const result = await db.transaction(async (tx) => {
    const op = await tx.one('SELECT o.*, s.name AS student_name FROM outpass_requests o JOIN users s ON s.id = o.student_id WHERE o.id = ? FOR UPDATE', [id]);
    if (!op) throw notFound('Outpass');
    if (op.status !== 'PENDING') throw conflict(`Outpass is ${op.status}, not PENDING`);
    if (new Date(op.expected_return_at) < now) throw conflict('Outpass return time has already passed');
    await tx.query("UPDATE outpass_requests SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ?, remarks = ? WHERE id = ?", [
      req.user.id, now, remarks || null, id,
    ]);
    if (op.pass_type === 'DAILY') return { op, tripId: null };
    const t = await tx.query(
      "INSERT INTO trips (request_id, trip_date, window_start, window_end, qr_token_id, status) VALUES (?, ?, ?, ?, ?, 'APPROVED')",
      [id, daily.localDate(new Date(op.depart_at)), op.depart_at, op.expected_return_at, newJti()],
    );
    await tx.query(
      `INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m, trip_id) VALUES (?, 'DESTINATION', 'CIRCLE', ?, ?, ?, ?)`,
      [`${op.destination_type === 'HOME' ? 'Home' : 'Destination'} of ${op.student_name} (#${id})`, op.dest_lat, op.dest_lng, radius, t.insertId],
    );
    return { op, tripId: t.insertId };
  });
  const { op } = result;
  let { tripId } = result;
  let studentBody = `Your outpass to ${op.dest_address} was approved${remarks ? `: "${remarks}"` : ''}. Show the QR code at the gate.`;
  let parentBody = `${op.student_name} may leave campus from ${tripSvc.fmtTime(op.depart_at)} and must return by ${tripSvc.fmtTime(op.expected_return_at)}.`;
  if (op.pass_type === 'DAILY') {
    const sc = await daily.getSchedule(id);
    tripId = (await daily.generateDailyTrips({ requestId: id }))[0] || null; // today's trip, if today is scheduled
    studentBody = `Your daily pass to ${sc.dest_name} (${scheduleText(sc)}) was approved${remarks ? `: "${remarks}"` : ''}. Each day's QR appears on your home screen.`;
    parentBody = `Daily pass approved for ${op.student_name}: ${sc.dest_name}, ${scheduleText(sc)}.`;
  }
  await audit(req, 'OUTPASS_APPROVED', 'outpass', id, { tripId, remarks, pass_type: op.pass_type });
  emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: 'APPROVED', remarks: remarks || null, reviewed_by: req.user.id, tripId });
  emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:approved' });
  await notify({
    userIds: [op.student_id],
    type: 'REQUEST_APPROVED',
    title: op.pass_type === 'DAILY' ? 'Daily pass approved' : 'Outpass approved',
    body: studentBody,
    tripId,
    data: { outpassId: id },
  });
  // Parents: once for the whole pass.
  await notify({
    userIds: await tripSvc.parentIds(op.student_id),
    type: 'REQUEST_APPROVED',
    title: `${op.pass_type === 'DAILY' ? 'Daily pass' : 'Outpass'} approved for ${op.student_name}`,
    body: parentBody,
    tripId,
    data: { outpassId: id },
  });
  return tripId;
}

router.post(
  '/bulk-approve',
  requireRole('warden', 'faculty', 'admin'),
  validate(z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(100), remarks: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const approved = [];
    const failed = [];
    for (const id of [...new Set(req.body.ids)]) {
      try {
        await approveOne(req, id, req.body.remarks);
        approved.push(id);
      } catch (err) {
        failed.push({ id, reason: err.message });
      }
    }
    ok(res, { approved, failed });
  }),
);

router.post(
  '/:id/approve',
  requireRole('warden', 'faculty', 'admin'),
  validate(z.object({ remarks: z.string().trim().max(500).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await approveOne(req, id, req.body.remarks);
    ok(res, await repo.getOutpass(id));
  }),
);

router.post(
  '/:id/reject',
  requireRole('warden', 'faculty', 'admin'),
  validate(z.object({ remarks: z.string().trim().min(3, 'Remarks are required when rejecting').max(500) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const r = await db.query(
      "UPDATE outpass_requests SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ?, remarks = ? WHERE id = ? AND status = 'PENDING'",
      [req.user.id, new Date(), req.body.remarks, id],
    );
    if (!r.affectedRows) {
      if (!(await db.one('SELECT id FROM outpass_requests WHERE id = ?', [id]))) throw notFound('Outpass');
      throw conflict('Only pending outpasses can be rejected');
    }
    await db.query("UPDATE outpass_schedules SET status = 'CANCELLED', status_changed_by = ?, status_changed_at = ?, status_note = ? WHERE request_id = ?", [
      req.user.id, new Date(), req.body.remarks, id,
    ]);
    const op = await repo.getOutpass(id);
    await audit(req, 'OUTPASS_REJECTED', 'outpass', id, { remarks: req.body.remarks });
    emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: 'REJECTED', remarks: op.remarks, reviewed_by: req.user.id, tripId: null });
    emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:rejected' });
    await notify({
      userIds: [op.student_id],
      type: 'REQUEST_REJECTED',
      title: op.pass_type === 'DAILY' ? 'Daily pass rejected' : 'Outpass rejected',
      body: `Your ${op.pass_type === 'DAILY' ? 'daily pass' : 'outpass'} to ${op.dest_address} was rejected: "${op.remarks}"`,
      data: { outpassId: id },
    });
    ok(res, op);
  }),
);

module.exports = router;

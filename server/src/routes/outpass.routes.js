const express = require('express');
const { z } = require('zod');
const db = require('../db');
const repo = require('../services/repo');
const ai = require('../services/ai');
const settings = require('../services/settings.service');
const tripSvc = require('../services/trip.service');
const { notify } = require('../services/notification.service');
const { emitTo, rooms } = require('../realtime');
const { authenticate, requireRole, isStaff } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, forbidden, conflict } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination, csvList } = require('../utils/http');
const { newJti } = require('../utils/qr');

const router = express.Router();
router.use(authenticate());

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'EXPIRED'];
const CATEGORIES = ['HOME_VISIT', 'MEDICAL', 'FAMILY_EVENT', 'ACADEMIC', 'PERSONAL', 'SHOPPING', 'OTHER'];

const createSchema = z
  .object({
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

router.post(
  '/',
  requireRole('student'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const open = await db.one(
      "SELECT id FROM outpass_requests WHERE student_id = ? AND status IN ('ACTIVE','OVERDUE') LIMIT 1",
      [req.user.id],
    );
    if (open) throw conflict('You already have an active trip. Return to campus before requesting a new outpass.');

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
    await audit(req, 'OUTPASS_CREATED', 'outpass', op.id, { risk_score: op.risk_score });
    emitTo(rooms.staff, 'request:new', op);
    emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:new' });
    await notify({
      userIds: await repo.wardensFor(req.user.id),
      type: 'REQUEST_SUBMITTED',
      title: `New outpass: ${op.student.name}${op.risk_level === 'HIGH' ? ' (HIGH RISK)' : ''}`,
      body: `${op.reason_category.replace('_', ' ').toLowerCase()} — ${op.dest_address}. Risk ${op.risk_score ?? '–'}/100.`,
      data: { outpassId: op.id },
    });
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

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Outpass objects never carry location data, so the same shape is safe for parents.
    const op = await loadScoped(req.user, Number(req.params.id));
    const extra = op.trip ? { gate_logs: await repo.getGateLogs(op.trip.id), events: await repo.getTripEvents(op.trip.id) } : { gate_logs: [], events: [] };
    ok(res, { ...op, ...extra });
  }),
);

router.post(
  '/:id/cancel',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const op = await loadScoped(req.user, id);
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

/** Approve one request: creates the trip, the QR jti and the destination geofence. */
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
    const t = await tx.query("INSERT INTO trips (request_id, qr_token_id, status) VALUES (?, ?, 'APPROVED')", [id, newJti()]);
    await tx.query(
      `INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m, trip_id) VALUES (?, 'DESTINATION', 'CIRCLE', ?, ?, ?, ?)`,
      [`${op.destination_type === 'HOME' ? 'Home' : 'Destination'} of ${op.student_name} (#${id})`, op.dest_lat, op.dest_lng, radius, t.insertId],
    );
    return { op, tripId: t.insertId };
  });
  const { op, tripId } = result;
  await audit(req, 'OUTPASS_APPROVED', 'outpass', id, { tripId, remarks });
  emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: 'APPROVED', remarks: remarks || null, reviewed_by: req.user.id, tripId });
  emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:approved' });
  await notify({
    userIds: [op.student_id],
    type: 'REQUEST_APPROVED',
    title: 'Outpass approved',
    body: `Your outpass to ${op.dest_address} was approved${remarks ? `: "${remarks}"` : ''}. Show the QR code at the gate.`,
    tripId,
    data: { outpassId: id },
  });
  await notify({
    userIds: await tripSvc.parentIds(op.student_id),
    type: 'REQUEST_APPROVED',
    title: `Outpass approved for ${op.student_name}`,
    body: `${op.student_name} may leave campus from ${tripSvc.fmtTime(op.depart_at)} and must return by ${tripSvc.fmtTime(op.expected_return_at)}.`,
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
    const op = await repo.getOutpass(id);
    await audit(req, 'OUTPASS_REJECTED', 'outpass', id, { remarks: req.body.remarks });
    emitTo([rooms.staff, rooms.user(op.student_id)], 'request:updated', { id, status: 'REJECTED', remarks: op.remarks, reviewed_by: req.user.id, tripId: null });
    emitTo(rooms.staff, 'dashboard:refresh', { reason: 'request:rejected' });
    await notify({
      userIds: [op.student_id],
      type: 'REQUEST_REJECTED',
      title: 'Outpass rejected',
      body: `Your outpass to ${op.dest_address} was rejected: "${op.remarks}"`,
      data: { outpassId: id },
    });
    ok(res, op);
  }),
);

module.exports = router;

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const gate = require('../services/gate.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination, iso } = require('../utils/http');

const router = express.Router();
router.use(authenticate());

const tokenSchema = z.object({ token: z.string().trim().min(10).max(2048) });

router.post(
  '/verify',
  requireRole('security', 'admin'),
  validate(tokenSchema),
  asyncHandler(async (req, res) => {
    // Preview only: rejections are logged, successful previews are not.
    const r = await gate.verifyToken(req.body.token, req.user.id);
    ok(res, { valid: true, action: r.action, student: r.student, outpass: r.outpass, trip: r.trip });
  }),
);

router.post(
  '/scan',
  requireRole('security', 'admin'),
  validate(tokenSchema),
  asyncHandler(async (req, res) => {
    const v = await gate.verifyToken(req.body.token, req.user.id);
    const r = await gate.record(v.raw, v.action, req.user.id, 'QR');
    await audit(req, `GATE_${r.action}`, 'trip', v.raw.id, { method: 'QR', result: r.gate_log.result });
    ok(res, r);
  }),
);

router.get(
  '/lookup',
  requireRole('security', 'admin'),
  validate(z.object({ roll_no: z.string().trim().min(1).max(40) }), 'query'),
  asyncHandler(async (req, res) => ok(res, await gate.lookupByRoll(req.validQuery.roll_no))),
);

router.post(
  '/manual',
  requireRole('security', 'admin'),
  validate(z.object({ trip_id: z.coerce.number().int().positive(), action: z.enum(['EXIT', 'ENTRY']), note: z.string().trim().max(255).optional() })),
  asyncHandler(async (req, res) => {
    const r = await gate.manual(req.body.trip_id, req.body.action, req.user.id, req.body.note || 'Manual lookup by roll number');
    await audit(req, `GATE_${r.action}`, 'trip', req.body.trip_id, { method: 'MANUAL', note: req.body.note });
    ok(res, r);
  }),
);

router.get(
  '/logs',
  requireRole('security', 'admin', 'warden', 'faculty'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query, { defaultSize: 50 });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    // Day boundaries in campus local time (IST).
    const where = date ? 'WHERE g.scanned_at >= ? AND g.scanned_at < ?' : '';
    const params = date ? [new Date(`${date}T00:00:00+05:30`), new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86_400_000)] : [];
    const rows = await db.query(
      `SELECT g.*, gu.name AS guard_name, s.id AS s_id, s.name AS s_name, s.roll_no AS s_roll_no, s.photo_url AS s_photo_url, s.phone AS s_phone
       FROM gate_logs g JOIN users gu ON gu.id = g.guard_id
       LEFT JOIN trips t ON t.id = g.trip_id LEFT JOIN outpass_requests o ON o.id = t.request_id LEFT JOIN users s ON s.id = o.student_id
       ${where} ORDER BY g.scanned_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM gate_logs g ${where}`, params);
    ok(
      res,
      rows.map((g) => ({
        id: g.id,
        trip_id: g.trip_id,
        type: g.type,
        scanned_at: iso(g.scanned_at),
        result: g.result,
        method: g.method,
        note: g.note,
        guard: { id: g.guard_id, name: g.guard_name },
        student: g.s_id ? { id: g.s_id, name: g.s_name, roll_no: g.s_roll_no, photo_url: g.s_photo_url, phone: g.s_phone } : null,
      })),
      { page, pageSize, total: Number(total) },
    );
  }),
);

module.exports = router;

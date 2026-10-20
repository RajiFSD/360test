const express = require('express');
const { z } = require('zod');
const db = require('../db');
const repo = require('../services/repo');
const settings = require('../services/settings.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination, iso } = require('../utils/http');

const router = express.Router();
router.use(authenticate(), requireRole('admin'));

// ---- departments ----
const deptSchema = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().toUpperCase().min(1).max(20) });
router.get('/departments', asyncHandler(async (req, res) => ok(res, await db.query('SELECT id, name, code FROM departments ORDER BY name'))));
router.post(
  '/departments',
  validate(deptSchema),
  asyncHandler(async (req, res) => {
    const r = await db.query('INSERT INTO departments (name, code) VALUES (?, ?)', [req.body.name, req.body.code]);
    await audit(req, 'DEPARTMENT_CREATED', 'department', r.insertId, req.body);
    ok(res, { id: r.insertId, ...req.body }, undefined, 201);
  }),
);
router.put(
  '/departments/:id',
  validate(deptSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await db.one('SELECT * FROM departments WHERE id = ?', [id]);
    if (!cur) throw notFound('Department');
    const next = { ...cur, ...req.body };
    await db.query('UPDATE departments SET name = ?, code = ? WHERE id = ?', [next.name, next.code, id]);
    await audit(req, 'DEPARTMENT_UPDATED', 'department', id, req.body);
    ok(res, { id, name: next.name, code: next.code });
  }),
);
router.delete(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    const r = await db.query('DELETE FROM departments WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) throw notFound('Department');
    await audit(req, 'DEPARTMENT_DELETED', 'department', req.params.id);
    ok(res, { ok: true });
  }),
);

// ---- hostels ----
const hostelSchema = z.object({ name: z.string().trim().min(2).max(120), warden_id: z.coerce.number().int().positive().optional().nullable() });
router.get('/hostels', asyncHandler(async (req, res) => ok(res, await db.query(
  'SELECT h.id, h.name, h.warden_id, w.name AS warden_name FROM hostels h LEFT JOIN users w ON w.id = h.warden_id ORDER BY h.name',
))));
router.post(
  '/hostels',
  validate(hostelSchema),
  asyncHandler(async (req, res) => {
    const r = await db.query('INSERT INTO hostels (name, warden_id) VALUES (?, ?)', [req.body.name, req.body.warden_id ?? null]);
    await audit(req, 'HOSTEL_CREATED', 'hostel', r.insertId, req.body);
    ok(res, { id: r.insertId, name: req.body.name, warden_id: req.body.warden_id ?? null }, undefined, 201);
  }),
);
router.put(
  '/hostels/:id',
  validate(hostelSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await db.one('SELECT * FROM hostels WHERE id = ?', [id]);
    if (!cur) throw notFound('Hostel');
    const next = { ...cur, ...req.body };
    await db.query('UPDATE hostels SET name = ?, warden_id = ? WHERE id = ?', [next.name, next.warden_id ?? null, id]);
    await audit(req, 'HOSTEL_UPDATED', 'hostel', id, req.body);
    ok(res, { id, name: next.name, warden_id: next.warden_id ?? null });
  }),
);
router.delete(
  '/hostels/:id',
  asyncHandler(async (req, res) => {
    const r = await db.query('DELETE FROM hostels WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) throw notFound('Hostel');
    await audit(req, 'HOSTEL_DELETED', 'hostel', req.params.id);
    ok(res, { ok: true });
  }),
);

// ---- parent-student links ----
async function serializeLinks(where, params) {
  const rows = await db.query(
    `SELECT l.id, l.relation, l.verified, l.verified_at, l.created_at,
            p.id AS p_id, p.name AS p_name, p.email AS p_email, p.phone AS p_phone,
            s.id AS s_id, s.name AS s_name, s.roll_no AS s_roll_no, s.photo_url AS s_photo_url, s.phone AS s_phone
     FROM parent_student_links l JOIN users p ON p.id = l.parent_id JOIN users s ON s.id = l.student_id
     WHERE ${where} ORDER BY l.created_at DESC LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    relation: r.relation,
    verified: !!r.verified,
    verified_at: iso(r.verified_at),
    created_at: iso(r.created_at),
    parent: { id: r.p_id, name: r.p_name, email: r.p_email, phone: r.p_phone },
    student: { id: r.s_id, name: r.s_name, roll_no: r.s_roll_no, photo_url: r.s_photo_url, phone: r.s_phone },
  }));
}

router.get(
  '/links',
  asyncHandler(async (req, res) => {
    const where = ['1=1'];
    const params = [];
    if (req.query.q) {
      const q = `%${req.query.q}%`;
      where.push('(p.name LIKE ? OR p.email LIKE ? OR s.name LIKE ? OR s.roll_no LIKE ?)');
      params.push(q, q, q, q);
    }
    if (req.query.verified === 'true' || req.query.verified === 'false') {
      where.push('l.verified = ?');
      params.push(req.query.verified === 'true' ? 1 : 0);
    }
    ok(res, await serializeLinks(where.join(' AND '), params));
  }),
);

router.post(
  '/links',
  validate(z.object({
    parent_id: z.coerce.number().int().positive(),
    student_id: z.coerce.number().int().positive(),
    relation: z.string().trim().max(40).optional().nullable(),
    verified: z.boolean().optional(),
  })),
  asyncHandler(async (req, res) => {
    const { parent_id, student_id, relation, verified } = req.body;
    const p = await db.one('SELECT role FROM users WHERE id = ?', [parent_id]);
    const s = await db.one('SELECT role FROM users WHERE id = ?', [student_id]);
    if (p?.role !== 'parent') throw badRequest('parent_id must be a parent account');
    if (s?.role !== 'student') throw badRequest('student_id must be a student account');
    const r = await db.query(
      'INSERT INTO parent_student_links (parent_id, student_id, relation, verified, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
      [parent_id, student_id, relation || null, verified ? 1 : 0, verified ? req.user.id : null, verified ? new Date() : null],
    );
    await audit(req, 'LINK_CREATED', 'link', r.insertId, req.body);
    ok(res, (await serializeLinks('l.id = ?', [r.insertId]))[0], undefined, 201);
  }),
);

router.patch(
  '/links/:id',
  validate(z.object({ verified: z.boolean().optional(), relation: z.string().trim().max(40).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await db.one('SELECT * FROM parent_student_links WHERE id = ?', [id]);
    if (!cur) throw notFound('Link');
    const verified = req.body.verified ?? !!cur.verified;
    await db.query('UPDATE parent_student_links SET verified = ?, relation = ?, verified_by = ?, verified_at = ? WHERE id = ?', [
      verified ? 1 : 0,
      req.body.relation !== undefined ? req.body.relation : cur.relation,
      verified ? req.user.id : null,
      verified ? cur.verified_at || new Date() : null,
      id,
    ]);
    await audit(req, verified ? 'LINK_VERIFIED' : 'LINK_UPDATED', 'link', id, req.body);
    ok(res, (await serializeLinks('l.id = ?', [id]))[0]);
  }),
);

router.delete(
  '/links/:id',
  asyncHandler(async (req, res) => {
    const r = await db.query('DELETE FROM parent_student_links WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) throw notFound('Link');
    await audit(req, 'LINK_DELETED', 'link', req.params.id);
    ok(res, { ok: true });
  }),
);

// ---- settings ----
router.get('/settings', asyncHandler(async (req, res) => ok(res, await settings.getAll({ fresh: true }))));
router.get('/settings/schema', asyncHandler(async (req, res) => ok(res, settings.DEFAULTS)));
router.put(
  '/settings',
  validate(z.record(z.union([z.string(), z.number(), z.boolean()]))),
  asyncHandler(async (req, res) => {
    const updated = await settings.update(req.body);
    await audit(req, 'SETTINGS_UPDATED', 'settings', null, req.body);
    ok(res, updated);
  }),
);

// ---- run a scheduled job now (demos, testing, ops) ----
const JOBS = {
  overdue: () => require('../jobs/overdue.job').runOverdueCheck(),
  'signal-lost': () => require('../jobs/monitor.jobs').runSignalLostCheck(),
  'auto-complete': () => require('../jobs/monitor.jobs').runAutoComplete(),
  expiry: () => require('../jobs/monitor.jobs').runExpiry(),
  'ping-retention': () => require('../jobs/monitor.jobs').runPingRetention(),
  'daily-passes': () => require('../jobs/monitor.jobs').runDailyPasses(),
};
router.post(
  '/jobs/:name/run',
  asyncHandler(async (req, res) => {
    const job = JOBS[req.params.name];
    if (!job) throw badRequest(`Unknown job. Use one of: ${Object.keys(JOBS).join(', ')}`);
    const result = await job();
    await audit(req, 'JOB_RUN', 'job', req.params.name, result);
    ok(res, { job: req.params.name, result });
  }),
);

// ---- audit logs ----
router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query, { defaultSize: 50 });
    const where = ['1=1'];
    const params = [];
    if (req.query.action) {
      where.push('a.action LIKE ?');
      params.push(`%${String(req.query.action).toUpperCase()}%`);
    }
    if (req.query.actor_id) {
      where.push('a.actor_id = ?');
      params.push(Number(req.query.actor_id));
    }
    if (req.query.entity) {
      where.push('a.entity = ?');
      params.push(String(req.query.entity));
    }
    const w = where.join(' AND ');
    const rows = await db.query(
      `SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${w}`, params);
    ok(
      res,
      rows.map((a) => ({
        id: a.id,
        actor: a.actor_id ? { id: a.actor_id, name: a.actor_name, role: a.actor_role } : null,
        action: a.action,
        entity: a.entity,
        entity_id: a.entity_id,
        details: repo.parseJson(a.details),
        ip: a.ip,
        created_at: iso(a.created_at),
      })),
      { page, pageSize, total: Number(total) },
    );
  }),
);

module.exports = router;

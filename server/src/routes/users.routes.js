const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const repo = require('../services/repo');
const { authenticate, requireRole, isStaff } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, forbidden, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination } = require('../utils/http');

const router = express.Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const ROLES = ['student', 'warden', 'faculty', 'security', 'parent', 'admin'];

const userBase = {
  role: z.enum(ROLES),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  phone: z.string().trim().max(30).optional().nullable(),
  roll_no: z.string().trim().toUpperCase().max(40).optional().nullable(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  hostel_id: z.coerce.number().int().positive().optional().nullable(),
  photo_url: z.string().trim().max(500).optional().nullable(),
};
const createSchema = z
  .object({ ...userBase, password: z.string().min(8).max(200) })
  .refine((u) => u.role !== 'student' || !!u.roll_no, { message: 'roll_no is required for students', path: ['roll_no'] });
const updateSchema = z
  .object({ ...userBase, password: z.string().min(8).max(200).optional(), is_active: z.boolean().optional() })
  .partial();

router.use(authenticate());

router.get(
  '/',
  requireRole('admin', 'warden', 'faculty', 'security'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query);
    const where = [];
    const params = [];
    let role = req.query.role;
    if (req.user.role !== 'admin') role = 'student'; // staff/security may only browse students
    if (role && ROLES.includes(role)) {
      where.push('u.role = ?');
      params.push(role);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.roll_no LIKE ? OR u.phone LIKE ?)');
      const q = `%${String(req.query.q).trim()}%`;
      params.push(q, q, q, q);
    }
    if (req.query.hostel_id) {
      where.push('u.hostel_id = ?');
      params.push(Number(req.query.hostel_id));
    }
    if (req.query.department_id) {
      where.push('u.department_id = ?');
      params.push(Number(req.query.department_id));
    }
    if (req.query.is_active === 'true' || req.query.is_active === 'false') {
      where.push('u.is_active = ?');
      params.push(req.query.is_active === 'true' ? 1 : 0);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.query(`${repo.USER_SELECT} ${w} ORDER BY u.role, u.name LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM users u ${w}`, params);
    ok(res, rows.map(repo.serializeUser), { page, pageSize, total: Number(total) });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const hash = await bcrypt.hash(b.password, config.bcryptRounds);
    const r = await db.query(
      `INSERT INTO users (role, name, email, phone, password_hash, roll_no, department_id, hostel_id, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.role, b.name, b.email, b.phone || null, hash, b.roll_no || null, b.department_id || null, b.hostel_id || null, b.photo_url || null],
    );
    await audit(req, 'USER_CREATED', 'user', r.insertId, { role: b.role, email: b.email });
    ok(res, await repo.getUser(r.insertId), undefined, 201);
  }),
);

router.post(
  '/import',
  requireRole('admin'),
  csvUpload.single('file'),
  asyncHandler(async (req, res) => {
    const text = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.csv === 'string' ? req.body.csv : null;
    if (!text) throw badRequest('Upload a CSV file in field "file"');
    let records;
    try {
      records = parse(text, { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw badRequest(`Invalid CSV: ${err.message}`);
    }
    const depts = await db.query('SELECT id, name, code FROM departments');
    const hostels = await db.query('SELECT id, name FROM hostels');
    const findDept = (v) => depts.find((d) => d.name.toLowerCase() === v.toLowerCase() || d.code.toLowerCase() === v.toLowerCase());
    const findHostel = (v) => hostels.find((h) => h.name.toLowerCase() === v.toLowerCase());

    const result = { created: 0, skipped: 0, errors: [] };
    for (let i = 0; i < records.length; i++) {
      const line = i + 2;
      const rec = records[i];
      const dept = rec.department ? findDept(rec.department) : null;
      const hostel = rec.hostel ? findHostel(rec.hostel) : null;
      const parsed = createSchema.safeParse({
        role: (rec.role || '').toLowerCase(),
        name: rec.name,
        email: rec.email,
        phone: rec.phone || null,
        roll_no: rec.roll_no || null,
        department_id: dept?.id ?? null,
        hostel_id: hostel?.id ?? null,
        password: rec.password || '',
      });
      if (!parsed.success) {
        result.errors.push({ line, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
        continue;
      }
      if (rec.department && !dept) result.errors.push({ line, message: `Unknown department "${rec.department}" (user created without it)` });
      if (rec.hostel && !hostel) result.errors.push({ line, message: `Unknown hostel "${rec.hostel}" (user created without it)` });
      const u = parsed.data;
      const exists = await db.one('SELECT id FROM users WHERE email = ? OR (roll_no IS NOT NULL AND roll_no = ?)', [u.email, u.roll_no || '']);
      if (exists) {
        result.skipped++;
        continue;
      }
      await db.query(
        `INSERT INTO users (role, name, email, phone, password_hash, roll_no, department_id, hostel_id, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [u.role, u.name, u.email, u.phone, await bcrypt.hash(u.password, config.bcryptRounds), u.roll_no, u.department_id, u.hostel_id,
          u.role === 'admin' ? 0 : 1],
      );
      result.created++;
    }
    await audit(req, 'USERS_IMPORTED', 'user', null, { created: result.created, skipped: result.skipped, errors: result.errors.length });
    ok(res, result);
  }),
);

/** Students may be read by staff/security; anything else by admin or self. */
async function assertCanRead(req, id) {
  if (req.user.role === 'admin' || req.user.id === id) return;
  const target = await db.one('SELECT role FROM users WHERE id = ?', [id]);
  if (!target) throw notFound('User');
  if (target.role === 'student' && (isStaff(req.user) || req.user.role === 'security')) return;
  if (req.user.role === 'parent' && (await repo.linkedStudentIds(req.user.id)).includes(id)) return;
  throw forbidden();
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertCanRead(req, id);
    const user = await repo.getUser(id);
    if (!user) throw notFound('User');
    ok(res, user);
  }),
);

router.put(
  '/:id',
  requireRole('admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await db.one('SELECT id FROM users WHERE id = ?', [id]))) throw notFound('User');
    const b = { ...req.body };
    if (b.password) {
      b.password_hash = await bcrypt.hash(b.password, config.bcryptRounds);
      delete b.password;
    }
    if (b.is_active !== undefined) b.is_active = b.is_active ? 1 : 0;
    const fields = Object.entries(b).filter(([, v]) => v !== undefined);
    if (fields.length) {
      await db.query(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [...fields.map(([, v]) => v), id]);
    }
    if (b.is_active === 0) await db.query('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [new Date(), id]);
    await audit(req, 'USER_UPDATED', 'user', id, { fields: fields.map(([k]) => k) });
    ok(res, await repo.getUser(id));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('You cannot deactivate your own account');
    const r = await db.query('UPDATE users SET is_active = 0, push_token = NULL WHERE id = ?', [id]);
    if (!r.affectedRows) throw notFound('User');
    await db.query('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [new Date(), id]);
    await audit(req, 'USER_DEACTIVATED', 'user', id);
    ok(res, { ok: true });
  }),
);

router.get(
  '/:id/history',
  requireRole('admin', 'warden', 'faculty'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await repo.getUser(id);
    if (!student || student.role !== 'student') throw notFound('Student');
    const { items } = await repo.listOutpasses('o.student_id = ?', [id], { limit: 200 });
    const stats = await db.one(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(t.status = 'COMPLETED'), 0) AS completed,
              COALESCE(SUM(t.status = 'COMPLETED' AND COALESCE(t.entry_at, t.completed_at) > DATE_ADD(t.window_end, INTERVAL 15 MINUTE)), 0) AS late,
              AVG(CASE WHEN t.status = 'COMPLETED' THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, t.window_end, COALESCE(t.entry_at, t.completed_at))) END) AS avg_delay
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id AND o.pass_type = 'ONE_TIME' WHERE o.student_id = ?`,
      [id],
    );
    const completed = Number(stats.completed);
    ok(res, {
      student,
      stats: {
        total: Number(stats.total),
        completed,
        late: Number(stats.late),
        late_rate: completed ? Number((Number(stats.late) / completed).toFixed(3)) : 0,
        avg_delay_min: Math.round(Number(stats.avg_delay || 0)),
      },
      outpasses: items,
    });
  }),
);

module.exports = router;

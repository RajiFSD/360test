/** Admin review of self-registered students and parents. Parent links are verified separately (Parent links page). */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const repo = require('../services/repo');
const { notify } = require('../services/notification.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, conflict } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, iso } = require('../utils/http');

const router = express.Router();
router.use(authenticate(), requireRole('admin'));

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

router.get(
  '/count',
  asyncHandler(async (req, res) => {
    const r = await db.one("SELECT COUNT(*) AS n FROM users WHERE registration_status = 'PENDING'");
    ok(res, { pending: Number(r.n) });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = STATUSES.includes(String(req.query.status || '').toUpperCase()) ? String(req.query.status).toUpperCase() : 'PENDING';
    // Self-registered accounts are the ones carrying registration review data or still pending.
    const rows = await db.query(
      `SELECT u.id, u.role, u.name, u.email, u.phone, u.roll_no, u.created_at, u.registration_status, u.registration_note,
              u.registration_details, u.registration_reviewed_at, d.name AS department, h.name AS hostel, rv.name AS reviewer
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN hostels h ON h.id = u.hostel_id
       LEFT JOIN users rv ON rv.id = u.registration_reviewed_by
       WHERE u.registration_status = ? AND u.role IN ('student','parent')
         AND (u.registration_status = 'PENDING' OR u.registration_reviewed_at IS NOT NULL)
       ORDER BY u.created_at ${status === 'PENDING' ? 'ASC' : 'DESC'} LIMIT 500`,
      [status],
    );
    // Resolve parents' children roll numbers to students (admin-only view).
    const rolls = [...new Set(rows.flatMap((r) => (repo.parseJson(r.registration_details)?.children || []).map((c) => c.roll_no)))];
    const students = rolls.length
      ? await db.query("SELECT id, name, roll_no FROM users WHERE role = 'student' AND roll_no IN (?)", [rolls])
      : [];
    const byRoll = new Map(students.map((s) => [s.roll_no.toUpperCase(), s]));
    ok(
      res,
      rows.map((r) => ({
        id: r.id,
        role: r.role,
        name: r.name,
        email: r.email,
        phone: r.phone,
        roll_no: r.roll_no,
        department: r.department,
        hostel: r.hostel,
        created_at: iso(r.created_at),
        registration_status: r.registration_status,
        registration_note: r.registration_note,
        reviewed_at: iso(r.registration_reviewed_at),
        reviewer: r.reviewer,
        children: (repo.parseJson(r.registration_details)?.children || []).map((c) => {
          const s = byRoll.get(String(c.roll_no).toUpperCase());
          return { roll_no: c.roll_no, relation: c.relation, student: s ? { id: s.id, name: s.name } : null };
        }),
      })),
    );
  }),
);

async function approve(req, id) {
  const r = await db.query(
    `UPDATE users SET is_active = 1, registration_status = 'APPROVED', registration_note = NULL,
       registration_reviewed_by = ?, registration_reviewed_at = ?
     WHERE id = ? AND registration_status = 'PENDING' AND role IN ('student','parent')`,
    [req.user.id, new Date(), id],
  );
  if (!r.affectedRows) {
    if (!(await db.one('SELECT id FROM users WHERE id = ?', [id]))) throw notFound('Registration');
    throw conflict('This registration is not pending');
  }
  const u = await db.one('SELECT role, name FROM users WHERE id = ?', [id]);
  await audit(req, 'REGISTRATION_APPROVED', 'user', id, { role: u.role });
  await notify({
    userIds: [id],
    type: 'REGISTRATION_APPROVED',
    title: 'Your SmartOutpass account is approved',
    body:
      u.role === 'parent'
        ? 'You can now sign in. Your link to your child becomes active once the college verifies it.'
        : 'You can now sign in to SmartOutpass.',
    sms: true,
  });
}

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    await approve(req, Number(req.params.id));
    ok(res, { ok: true });
  }),
);

router.post(
  '/bulk-approve',
  validate(z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const approved = [];
    const failed = [];
    for (const id of [...new Set(req.body.ids)]) {
      try {
        await approve(req, id);
        approved.push(id);
      } catch (err) {
        failed.push({ id, reason: err.message });
      }
    }
    ok(res, { approved, failed });
  }),
);

router.post(
  '/:id/reject',
  validate(z.object({ reason: z.string().trim().max(500).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reason = req.body.reason || null;
    const r = await db.query(
      `UPDATE users SET is_active = 0, registration_status = 'REJECTED', registration_note = ?,
         registration_reviewed_by = ?, registration_reviewed_at = ?
       WHERE id = ? AND registration_status = 'PENDING' AND role IN ('student','parent')`,
      [reason, req.user.id, new Date(), id],
    );
    if (!r.affectedRows) {
      if (!(await db.one('SELECT id FROM users WHERE id = ?', [id]))) throw notFound('Registration');
      throw conflict('This registration is not pending');
    }
    await audit(req, 'REGISTRATION_REJECTED', 'user', id, { reason });
    // The account stays inactive, so this reaches the user by SMS (if enabled) and the login screen shows the reason.
    await notify({
      userIds: [id],
      type: 'REGISTRATION_REJECTED',
      title: 'Your SmartOutpass registration was not approved',
      body: reason ? `Reason: ${reason}` : 'Please contact the college office for details.',
      sms: true,
      includeInactive: true,
    });
    ok(res, { ok: true });
  }),
);

module.exports = router;

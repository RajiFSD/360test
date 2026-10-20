/** Meta lookups, public settings, uploads, notifications inbox, parent view. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const repo = require('../services/repo');
const settings = require('../services/settings.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../utils/errors');
const { ok, pagination, iso } = require('../utils/http');

const router = express.Router();
router.use(authenticate());

// ---- meta ----
router.get('/meta/departments', asyncHandler(async (req, res) => ok(res, await db.query('SELECT id, name, code FROM departments ORDER BY name'))));
router.get('/meta/hostels', asyncHandler(async (req, res) => ok(res, await db.query('SELECT id, name, warden_id FROM hostels ORDER BY name'))));
router.get('/settings/public', asyncHandler(async (req, res) => ok(res, await settings.getPublic())));

// ---- uploads ----
fs.mkdirSync(config.uploadDir, { recursive: true });
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPG, PNG, WEBP or PDF files are allowed'))),
});
router.post(
  '/uploads',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded (field "file")');
    ok(res, { url: `/uploads/${path.basename(req.file.filename)}` }, undefined, 201);
  }),
);

// ---- notifications (own inbox = IN_APP channel) ----
const serializeNotification = (n) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  trip_id: n.trip_id,
  data: repo.parseJson(n.data),
  read_at: iso(n.read_at),
  created_at: iso(n.created_at),
});

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query);
    const unread = req.query.unread === 'true' ? ' AND read_at IS NULL' : '';
    const rows = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? AND channel = 'IN_APP'${unread} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset],
    );
    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND channel = 'IN_APP'${unread}`, [req.user.id]);
    ok(res, rows.map(serializeNotification), { page, pageSize, total: Number(total) });
  }),
);
router.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const r = await db.one("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND channel = 'IN_APP' AND read_at IS NULL", [req.user.id]);
    ok(res, { count: Number(r.count) });
  }),
);
router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await db.query("UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel = 'IN_APP' AND read_at IS NULL", [new Date(), req.user.id]);
    ok(res, { ok: true });
  }),
);
router.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const r = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', [
      new Date(),
      Number(req.params.id),
      req.user.id,
    ]);
    if (!r.affectedRows) throw notFound('Notification');
    ok(res, { ok: true });
  }),
);

// ---- parent ----
router.get(
  '/parent/students',
  requireRole('parent'),
  asyncHandler(async (req, res) => {
    const links = await db.query(
      `SELECT l.student_id, l.relation FROM parent_student_links l JOIN users s ON s.id = l.student_id
       WHERE l.parent_id = ? AND l.verified = 1 AND s.is_active = 1 ORDER BY s.name`,
      [req.user.id],
    );
    const out = [];
    for (const l of links) {
      const user = await repo.getUser(l.student_id);
      const { items } = await repo.listTrips("o.student_id = ? AND t.status IN ('APPROVED','ACTIVE','OVERDUE')", [l.student_id], { limit: 1 });
      const trip = items[0] || null;
      out.push({
        student: { id: user.id, name: user.name, roll_no: user.roll_no, photo_url: user.photo_url, phone: user.phone, department: user.department, hostel: user.hostel },
        relation: l.relation,
        // Never leak location unless the student consented for this trip.
        current_trip: trip ? (trip.tracking_active ? trip : { ...trip, last_location: null }) : null,
        tracking_visible: !!trip?.tracking_active,
      });
    }
    ok(res, out);
  }),
);

module.exports = router;

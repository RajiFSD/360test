const express = require('express');
const db = require('../db');
const repo = require('../services/repo');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const { ok } = require('../utils/http');

const router = express.Router();
router.use(authenticate());

/** Midnight in campus local time (IST) as a UTC Date. */
function startOfLocalDay(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

router.get(
  '/staff',
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const today = startOfLocalDay();
    const c = await db.one(
      `SELECT
         (SELECT COUNT(*) FROM outpass_requests WHERE status = 'PENDING') AS pending_count,
         (SELECT COUNT(*) FROM trips WHERE status = 'ACTIVE') AS active_count,
         (SELECT COUNT(*) FROM trips WHERE status = 'OVERDUE') AS overdue_count,
         (SELECT COUNT(*) FROM trips WHERE status = 'COMPLETED' AND completed_at >= ?) AS returned_today,
         (SELECT COUNT(*) FROM outpass_requests WHERE status = 'PENDING' AND risk_score >= 65) AS high_risk_pending,
         (SELECT COUNT(*) FROM trips t WHERE t.status IN ('ACTIVE','OVERDUE')
            AND EXISTS(SELECT 1 FROM tracking_consents c WHERE c.trip_id = t.id AND c.revoked_at IS NULL)) AS tracking_count`,
      [today],
    );
    const pending = await repo.listOutpasses("o.status = 'PENDING'", [], { limit: 10, order: 'o.risk_score DESC, o.depart_at ASC' });
    const overdue = await repo.listTrips("t.status = 'OVERDUE'", [], { limit: 10, order: 'o.expected_return_at ASC' });
    ok(res, {
      pending_count: Number(c.pending_count),
      active_count: Number(c.active_count),
      overdue_count: Number(c.overdue_count),
      returned_today: Number(c.returned_today),
      high_risk_pending: Number(c.high_risk_pending),
      tracking_count: Number(c.tracking_count),
      pending: pending.items,
      overdue: overdue.items.map((t) => ({ ...t, minutes_late: Math.max(0, Math.floor((Date.now() - new Date(t.expected_return_at)) / 60000)) })),
    });
  }),
);

router.get(
  '/student',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const active = await repo.listOutpasses("o.student_id = ? AND o.status IN ('PENDING','APPROVED','ACTIVE','OVERDUE')", [req.user.id], {
      limit: 1,
      order: "FIELD(o.status, 'OVERDUE','ACTIVE','APPROVED','PENDING'), o.depart_at",
    });
    const recent = await repo.listOutpasses('o.student_id = ?', [req.user.id], { limit: 5 });
    const s = await db.one(
      `SELECT COUNT(*) AS total, COALESCE(SUM(o.status = 'COMPLETED'), 0) AS completed,
              COALESCE(SUM(o.status = 'COMPLETED' AND COALESCE(t.entry_at, t.completed_at) > DATE_ADD(o.expected_return_at, INTERVAL 15 MINUTE)), 0) AS late
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id WHERE o.student_id = ?`,
      [req.user.id],
    );
    ok(res, {
      active_outpass: active.items[0] || null,
      recent: recent.items,
      stats: { total: Number(s.total), completed: Number(s.completed), late: Number(s.late) },
    });
  }),
);

router.get(
  '/admin',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const today = startOfLocalDay();
    const roles = await db.query('SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role');
    const c = await db.one(
      `SELECT (SELECT COUNT(*) FROM outpass_requests WHERE created_at >= ?) AS outpasses_today,
              (SELECT COUNT(*) FROM trips WHERE status = 'ACTIVE') AS active_trips,
              (SELECT COUNT(*) FROM trips WHERE status = 'OVERDUE') AS overdue_trips,
              (SELECT COUNT(*) FROM notifications WHERE created_at >= ?) AS notifications_today,
              (SELECT COUNT(*) FROM parent_student_links WHERE verified = 0) AS unverified_links`,
      [today, today],
    );
    const users_by_role = { student: 0, warden: 0, faculty: 0, security: 0, parent: 0, admin: 0 };
    roles.forEach((r) => (users_by_role[r.role] = Number(r.n)));
    ok(res, {
      users_by_role,
      outpasses_today: Number(c.outpasses_today),
      active_trips: Number(c.active_trips),
      overdue_trips: Number(c.overdue_trips),
      notifications_today: Number(c.notifications_today),
      unverified_links: Number(c.unverified_links),
    });
  }),
);

module.exports = router;
module.exports.startOfLocalDay = startOfLocalDay;

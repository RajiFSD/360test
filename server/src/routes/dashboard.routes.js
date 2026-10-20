const express = require('express');
const db = require('../db');
const repo = require('../services/repo');
const daily = require('../services/daily.service');
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
    const overdue = await repo.listTrips("t.status = 'OVERDUE'", [], { limit: 10, order: 't.window_end ASC' });
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
    await daily.generateDailyTrips({ studentId: req.user.id }); // lazy: today's trip for running daily passes
    // Daily passes running today: today's trip (with its window) or "no trip scheduled today".
    const runningPasses = await repo.listOutpasses(
      "o.student_id = ? AND o.pass_type = 'DAILY' AND o.status = 'APPROVED' AND sc.status IN ('ACTIVE','PAUSED')",
      [req.user.id],
      { limit: 5, order: 'sc.start_date' },
    );
    const today = daily.localDate();
    const daily_passes = runningPasses.items.map((p) => ({
      outpass: p,
      today: today,
      today_trip: p.trip && p.trip.trip_date === today ? p.trip : null,
      scheduled_today: p.schedule.status === 'ACTIVE' && p.schedule.start_date <= today && p.schedule.end_date >= today && p.schedule.days_of_week.includes(daily.dayOf(today)),
      day: p.trip ? daily.dayNumber(p.schedule, p.trip.trip_date) : null,
    }));
    const active = await repo.listOutpasses("o.student_id = ? AND o.pass_type = 'ONE_TIME' AND o.status IN ('PENDING','APPROVED','ACTIVE','OVERDUE')", [req.user.id], {
      limit: 1,
      order: "FIELD(o.status, 'OVERDUE','ACTIVE','APPROVED','PENDING'), o.depart_at",
    });
    const recent = await repo.listOutpasses('o.student_id = ?', [req.user.id], { limit: 5 });
    const s = await db.one(
      `SELECT COUNT(*) AS total, COALESCE(SUM(o.status = 'COMPLETED'), 0) AS completed,
              COALESCE(SUM(o.status = 'COMPLETED' AND COALESCE(t.entry_at, t.completed_at) > DATE_ADD(t.window_end, INTERVAL 15 MINUTE)), 0) AS late
       FROM outpass_requests o LEFT JOIN trips t ON t.request_id = o.id AND o.pass_type = 'ONE_TIME' WHERE o.student_id = ?`,
      [req.user.id],
    );
    ok(res, {
      daily_passes,
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

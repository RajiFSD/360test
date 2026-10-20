/**
 * Overdue + escalation job (cron: every 5 minutes).
 *
 * For each ACTIVE/OVERDUE trip that has not returned to campus:
 *   minutesLate >= overdue_grace_min      -> trip + request marked OVERDUE (once)
 *   minutesLate >= escalation_student_min -> level 1: notify student
 *   minutesLate >= escalation_warden_min  -> level 2: notify warden(s)
 *   minutesLate >= escalation_parent_min  -> level 3: notify parents + security
 * escalation_level is persisted so each level is sent exactly once.
 */
const db = require('../db');
const repo = require('../services/repo');
const settingsSvc = require('../services/settings.service');
const tripSvc = require('../services/trip.service');
const { notify } = require('../services/notification.service');

/** Pure: which escalation level applies for this lateness. */
function escalationLevelFor(minutesLate, s) {
  if (minutesLate >= s.escalation_parent_min) return 3;
  if (minutesLate >= s.escalation_warden_min) return 2;
  if (minutesLate >= s.escalation_student_min) return 1;
  return 0;
}

const defaultDeps = {
  getSettings: () => settingsSvc.getAll(),
  /** Trips past expected return that are still out. */
  findCandidates: (now) =>
    db.query(
      // Each trip's own window: per day for a daily pass. Only trips that exited (ACTIVE/OVERDUE) can be overdue.
      `SELECT t.id, t.request_id, t.status, t.escalation_level, o.student_id, t.window_end AS expected_return_at, s.name AS student_name, s.roll_no
       FROM trips t JOIN outpass_requests o ON o.id = t.request_id JOIN users s ON s.id = o.student_id
       WHERE t.status IN ('ACTIVE','OVERDUE') AND t.returned_at IS NULL AND t.window_end < ?`,
      [now],
    ),
  markOverdue: async (trip, now) => {
    await db.query("UPDATE trips SET status = 'OVERDUE' WHERE id = ? AND status = 'ACTIVE'", [trip.id]);
    await db.query("UPDATE outpass_requests SET status = 'OVERDUE' WHERE id = ? AND status = 'ACTIVE'", [trip.request_id]);
    if (await tripSvc.recordEvent(trip.id, 'OVERDUE', now)) {
      tripSvc.broadcastEvent(trip, 'OVERDUE', now);
      tripSvc.broadcastStatus(trip, 'OVERDUE', 'OVERDUE');
    }
  },
  setEscalationLevel: (tripId, level) =>
    db.query('UPDATE trips SET escalation_level = ? WHERE id = ? AND escalation_level < ?', [level, tripId, level]),
  notifyLevel: async (trip, level, minutesLate) => {
    const late = `${minutesLate} min`;
    if (level === 1) {
      await notify({
        userIds: [trip.student_id],
        type: 'OVERDUE',
        title: 'You are overdue',
        body: `Your outpass return time passed ${late} ago. Please return to campus or contact your warden.`,
        tripId: trip.id,
      });
    } else if (level === 2) {
      await notify({
        userIds: await repo.wardensFor(trip.student_id),
        type: 'OVERDUE',
        title: `Overdue: ${trip.student_name} (${trip.roll_no})`,
        body: `${trip.student_name} is ${late} late returning to campus.`,
        tripId: trip.id,
        sms: true,
      });
    } else if (level === 3) {
      const parents = (await repo.parentsOf(trip.student_id)).map((p) => p.id);
      await notify({
        userIds: parents,
        type: 'OVERDUE',
        title: `${trip.student_name} has not returned`,
        body: `${trip.student_name} is ${late} past the expected return time. The hostel warden has been informed.`,
        tripId: trip.id,
        sms: true,
      });
      await notify({
        userIds: await repo.securityUsers(),
        type: 'OVERDUE',
        title: `Watch for ${trip.student_name} (${trip.roll_no})`,
        body: `Student is ${late} overdue. Record ENTRY on arrival.`,
        tripId: trip.id,
      });
    }
    tripSvc.broadcastEvent(trip, 'ESCALATED', new Date(), { level, minutesLate });
  },
};

async function runOverdueCheck({ now = new Date(), deps = defaultDeps } = {}) {
  const s = await deps.getSettings();
  const candidates = await deps.findCandidates(now);
  const summary = { checked: candidates.length, markedOverdue: 0, notifications: [] };
  for (const trip of candidates) {
    const minutesLate = Math.floor((now - new Date(trip.expected_return_at)) / 60000);
    if (minutesLate >= s.overdue_grace_min && trip.status === 'ACTIVE') {
      await deps.markOverdue(trip, now);
      summary.markedOverdue++;
    }
    const target = escalationLevelFor(minutesLate, s);
    for (let level = (trip.escalation_level || 0) + 1; level <= target; level++) {
      await deps.notifyLevel(trip, level, minutesLate);
      summary.notifications.push({ tripId: trip.id, level });
    }
    if (target > (trip.escalation_level || 0)) await deps.setEscalationLevel(trip.id, target);
  }
  return summary;
}

module.exports = { runOverdueCheck, escalationLevelFor, defaultDeps };

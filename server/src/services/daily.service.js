/**
 * Daily (recurring) passes: schedule maths, per-day trip generation, expiry and attendance stats.
 * Campus local time is IST (UTC+05:30), like the rest of the app. Times in a schedule are local.
 */
const db = require('../db');
const repo = require('./repo');
const settingsSvc = require('./settings.service');
const { newJti } = require('../utils/qr');

const TZ_OFFSET_MIN = 330;
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAILY_CATEGORIES = ['COLLEGE_WORK', 'INTERNSHIP', 'TUITION', 'SPORTS', 'OTHER'];
const DAILY_CONSENT_TEXT =
  'I agree to share my live location with my warden and linked parents during the scheduled daily windows of this pass only. I can stop at any time; sharing ends automatically when each day’s trip is completed.';

/** 'YYYY-MM-DD' of a Date in campus local time. */
function localDate(d = new Date()) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
/** Local wall-clock (date 'YYYY-MM-DD', time 'HH:MM[:SS]') -> UTC Date. */
function localToUtc(date, time) {
  const t = String(time).length === 5 ? `${time}:00` : String(time).slice(0, 8);
  return new Date(`${date}T${t}+05:30`);
}
const dayOf = (date) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
// mysql2 runs with timezone 'Z', so DATE columns arrive as UTC midnight Dates.
const toDateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const daysSet = (v) => (Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean));

/** Every scheduled date between start and end (inclusive) on the selected weekdays. */
function scheduledDates({ start_date, end_date, days_of_week }) {
  const days = new Set(daysSet(days_of_week));
  const out = [];
  for (let d = toDateStr(start_date), end = toDateStr(end_date); d <= end && out.length < 400; d = addDays(d, 1)) {
    if (days.has(dayOf(d))) out.push(d);
  }
  return out;
}

/** "Day N of M" for a trip date (N = position among scheduled dates). */
function dayNumber(schedule, tripDate) {
  const dates = scheduledDates(schedule);
  return { day: dates.indexOf(toDateStr(tripDate)) + 1, total: dates.length };
}

function serializeSchedule(s, stats) {
  if (!s) return null;
  return {
    id: s.id,
    dest_name: s.dest_name,
    start_date: toDateStr(s.start_date),
    end_date: toDateStr(s.end_date),
    days_of_week: daysSet(s.days_of_week),
    depart_time: String(s.depart_time).slice(0, 5),
    return_time: String(s.return_time).slice(0, 5),
    status: s.status,
    consent_active: !!s.consent_granted_at && !s.consent_revoked_at,
    status_note: s.status_note,
    total_days: scheduledDates(s).length,
    ...(stats ? { stats } : {}),
  };
}

/**
 * Create today's trip for every ACTIVE schedule of an APPROVED daily pass whose weekday matches.
 * Idempotent thanks to UNIQUE(request_id, trip_date). Optionally limited to one request or one student.
 * Returns the ids of trips created by this call.
 */
async function generateDailyTrips({ now = new Date(), requestId = null, studentId = null } = {}) {
  const today = localDate(now);
  const weekday = dayOf(today);
  const filters = [];
  const params = [today, today, weekday];
  if (requestId) {
    filters.push('o.id = ?');
    params.push(requestId);
  }
  if (studentId) {
    filters.push('o.student_id = ?');
    params.push(studentId);
  }
  const schedules = await db.query(
    `SELECT sc.*, o.student_id, o.dest_lat, o.dest_lng, s.name AS student_name
     FROM outpass_schedules sc
     JOIN outpass_requests o ON o.id = sc.request_id
     JOIN users s ON s.id = o.student_id
     WHERE sc.status = 'ACTIVE' AND o.status = 'APPROVED' AND o.pass_type = 'DAILY'
       AND sc.start_date <= ? AND sc.end_date >= ? AND FIND_IN_SET(?, sc.days_of_week)
       ${filters.length ? `AND ${filters.join(' AND ')}` : ''}`,
    params,
  );
  if (!schedules.length) return [];
  const radius = await settingsSvc.get('destination_radius_m');
  const created = [];
  for (const sc of schedules) {
    const tripId = await db.transaction(async (tx) => {
      const r = await tx.query(
        `INSERT IGNORE INTO trips (request_id, trip_date, window_start, window_end, qr_token_id, status)
         VALUES (?, ?, ?, ?, ?, 'APPROVED')`,
        [sc.request_id, today, localToUtc(today, sc.depart_time), localToUtc(today, sc.return_time), newJti()],
      );
      if (r.affectedRows !== 1) return null; // already generated
      await tx.query(
        "INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m, trip_id) VALUES (?, 'DESTINATION', 'CIRCLE', ?, ?, ?, ?)",
        [`${sc.dest_name} — ${sc.student_name} (${today})`.slice(0, 120), sc.dest_lat, sc.dest_lng, radius, r.insertId],
      );
      // The pass-level consent covers each scheduled window: give this day's trip its own consent record.
      if (sc.consent_granted_at && !sc.consent_revoked_at) {
        await tx.query(
          "INSERT INTO tracking_consents (trip_id, student_id, scope, consent_text, granted_at) VALUES (?, ?, 'TRIP_LOCATION', ?, ?)",
          [r.insertId, sc.student_id, DAILY_CONSENT_TEXT, now],
        );
      }
      return r.insertId;
    });
    if (tripId) created.push(tripId);
  }
  return created;
}

/** Schedules past their end date -> EXPIRED; the pass request -> COMPLETED. */
async function expireSchedules(now = new Date()) {
  const today = localDate(now);
  const rows = await db.query("SELECT id, request_id FROM outpass_schedules WHERE status IN ('ACTIVE','PAUSED') AND end_date < ?", [today]);
  for (const r of rows) {
    await db.query("UPDATE outpass_schedules SET status = 'EXPIRED', status_changed_at = ? WHERE id = ?", [now, r.id]);
    await db.query("UPDATE outpass_requests SET status = 'COMPLETED' WHERE id = ? AND status = 'APPROVED'", [r.request_id]);
  }
  return rows.length;
}

const LATE = 'COALESCE(t.entry_at, t.completed_at) > DATE_ADD(t.window_end, INTERVAL 15 MINUTE)';

/** Attendance per pass: scheduled days so far vs used / late / no-show. */
async function passStats(requestIds, now = new Date()) {
  if (!requestIds.length) return new Map();
  const rows = await db.query(
    `SELECT t.request_id,
            SUM(t.status = 'COMPLETED') AS completed,
            SUM(t.status = 'COMPLETED' AND ${LATE}) AS late,
            SUM(t.status = 'NO_SHOW') AS no_show,
            SUM(t.status IN ('ACTIVE','OVERDUE')) AS in_progress
     FROM trips t WHERE t.request_id IN (?) GROUP BY t.request_id`,
    [requestIds],
  );
  const schedules = await db.query('SELECT * FROM outpass_schedules WHERE request_id IN (?)', [requestIds]);
  const today = localDate(now);
  const out = new Map();
  for (const sc of schedules) {
    const r = rows.find((x) => x.request_id === sc.request_id) || {};
    const completed = Number(r.completed || 0);
    const noShow = Number(r.no_show || 0);
    out.set(sc.request_id, {
      total_days: scheduledDates(sc).length,
      scheduled_to_date: scheduledDates({ ...sc, end_date: toDateStr(sc.end_date) < today ? sc.end_date : today }).length,
      completed,
      late: Number(r.late || 0),
      no_show: noShow,
      in_progress: Number(r.in_progress || 0),
      late_rate: completed ? Number((Number(r.late || 0) / completed).toFixed(3)) : 0,
      no_show_rate: completed + noShow ? Number((noShow / (completed + noShow)).toFixed(3)) : 0,
    });
  }
  return out;
}

async function getSchedule(requestId, conn = db) {
  return conn.one('SELECT * FROM outpass_schedules WHERE request_id = ?', [requestId]);
}

/** Today's trip of a daily pass (if generated). */
async function todayTrip(requestId, now = new Date()) {
  const r = await db.one('SELECT id FROM trips WHERE request_id = ? AND trip_date = ?', [requestId, localDate(now)]);
  return r ? repo.getTrip(r.id) : null;
}

module.exports = {
  DAYS,
  DAILY_CATEGORIES,
  DAILY_CONSENT_TEXT,
  localDate,
  localToUtc,
  dayOf,
  addDays,
  toDateStr,
  scheduledDates,
  dayNumber,
  serializeSchedule,
  generateDailyTrips,
  expireSchedules,
  passStats,
  getSchedule,
  todayTrip,
};

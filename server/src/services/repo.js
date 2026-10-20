/**
 * Shared queries + serializers so every route returns the same object shapes (see docs/API.md).
 */
const db = require('../db');
const { iso } = require('../utils/http');

const USER_SELECT = `
  SELECT u.id, u.role, u.name, u.email, u.phone, u.roll_no, u.department_id, d.name AS department,
         u.hostel_id, h.name AS hostel, u.photo_url, u.is_active, u.must_change_password, u.created_at
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN hostels h ON h.id = u.hostel_id`;

function serializeUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    email: r.email,
    phone: r.phone,
    roll_no: r.roll_no,
    department_id: r.department_id,
    department: r.department,
    hostel_id: r.hostel_id,
    hostel: r.hostel,
    photo_url: r.photo_url,
    is_active: !!r.is_active,
    must_change_password: !!r.must_change_password,
    created_at: iso(r.created_at),
  };
}

async function getUser(id) {
  return serializeUser(await db.one(`${USER_SELECT} WHERE u.id = ?`, [id]));
}

const studentSummary = (r, prefix = 's_') =>
  r[`${prefix}id`]
    ? {
        id: r[`${prefix}id`],
        name: r[`${prefix}name`],
        roll_no: r[`${prefix}roll_no`],
        photo_url: r[`${prefix}photo_url`],
        phone: r[`${prefix}phone`],
        department: r[`${prefix}department`],
        hostel: r[`${prefix}hostel`],
      }
    : null;

const STUDENT_COLS = `s.id AS s_id, s.name AS s_name, s.roll_no AS s_roll_no, s.photo_url AS s_photo_url, s.phone AS s_phone,
  sd.name AS s_department, sh.name AS s_hostel`;
const STUDENT_JOINS = `JOIN users s ON s.id = o.student_id
  LEFT JOIN departments sd ON sd.id = s.department_id
  LEFT JOIN hostels sh ON sh.id = s.hostel_id`;

const riskLevel = (score) => (score == null ? null : score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW');

const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

const TRIP_COLS = `t.id AS t_id, t.request_id AS t_request_id, t.status AS t_status, t.exit_at AS t_exit_at,
  t.exit_guard_id AS t_exit_guard_id, t.entry_at AS t_entry_at, t.entry_guard_id AS t_entry_guard_id,
  t.left_campus_at AS t_left_campus_at, t.reached_destination_at AS t_reached_destination_at,
  t.returned_at AS t_returned_at, t.completed_at AS t_completed_at, t.escalation_level AS t_escalation_level,
  t.last_ping_at AS t_last_ping_at,
  EXISTS(SELECT 1 FROM tracking_consents c WHERE c.trip_id = t.id AND c.revoked_at IS NULL) AS t_consent_active`;

function tripCore(r) {
  if (!r.t_id) return null;
  const consentActive = !!r.t_consent_active;
  return {
    id: r.t_id,
    request_id: r.t_request_id,
    status: r.t_status,
    exit_at: iso(r.t_exit_at),
    exit_guard_id: r.t_exit_guard_id,
    entry_at: iso(r.t_entry_at),
    entry_guard_id: r.t_entry_guard_id,
    left_campus_at: iso(r.t_left_campus_at),
    reached_destination_at: iso(r.t_reached_destination_at),
    returned_at: iso(r.t_returned_at),
    completed_at: iso(r.t_completed_at),
    escalation_level: r.t_escalation_level,
    last_ping_at: iso(r.t_last_ping_at),
    consent_active: consentActive,
    tracking_active: consentActive && (r.t_status === 'ACTIVE' || r.t_status === 'OVERDUE'),
  };
}

function serializeOutpass(r) {
  const trip = tripCore(r);
  return {
    id: r.id,
    student_id: r.student_id,
    student: studentSummary(r),
    reason: r.reason,
    reason_category: r.reason_category,
    destination_type: r.destination_type,
    dest_address: r.dest_address,
    dest_lat: Number(r.dest_lat),
    dest_lng: Number(r.dest_lng),
    depart_at: iso(r.depart_at),
    expected_return_at: iso(r.expected_return_at),
    attachment_url: r.attachment_url,
    status: r.status,
    reviewed_by: r.reviewed_by,
    reviewer: r.reviewed_by ? { id: r.reviewed_by, name: r.reviewer_name } : null,
    reviewed_at: iso(r.reviewed_at),
    remarks: r.remarks,
    risk_score: r.risk_score,
    risk_level: riskLevel(r.risk_score),
    risk_reasons: parseJson(r.risk_reasons) || [],
    predicted_delay_min: r.predicted_delay_min,
    delay_probability: r.delay_probability != null ? Number(r.delay_probability) : null,
    created_at: iso(r.created_at),
    trip,
  };
}

const OUTPASS_SELECT = `
  SELECT o.*, rv.name AS reviewer_name, ${STUDENT_COLS}, ${TRIP_COLS}
  FROM outpass_requests o
  ${STUDENT_JOINS}
  LEFT JOIN users rv ON rv.id = o.reviewed_by
  LEFT JOIN trips t ON t.request_id = o.id`;

/** where: SQL fragment using aliases o, s, t (e.g. "o.status = ?"). */
async function listOutpasses(where = '1=1', params = [], { limit = 20, offset = 0, order = 'o.created_at DESC' } = {}) {
  const rows = await db.query(`${OUTPASS_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM outpass_requests o ${STUDENT_JOINS} LEFT JOIN trips t ON t.request_id = o.id WHERE ${where}`,
    params,
  );
  return { items: rows.map(serializeOutpass), total: Number(total) };
}

async function getOutpass(id) {
  const r = await db.one(`${OUTPASS_SELECT} WHERE o.id = ?`, [id]);
  return r ? serializeOutpass(r) : null;
}

const TRIP_SELECT = `
  SELECT o.*, ${STUDENT_COLS}, ${TRIP_COLS},
         lp.lat AS lp_lat, lp.lng AS lp_lng, lp.accuracy AS lp_accuracy, lp.speed AS lp_speed,
         lp.battery AS lp_battery, lp.recorded_at AS lp_recorded_at
  FROM trips t
  JOIN outpass_requests o ON o.id = t.request_id
  ${STUDENT_JOINS}
  LEFT JOIN location_pings lp ON lp.id = (
    SELECT p.id FROM location_pings p WHERE p.trip_id = t.id ORDER BY p.recorded_at DESC LIMIT 1)`;

function serializeTrip(r) {
  return {
    ...tripCore(r),
    student_id: r.student_id,
    student: studentSummary(r),
    reason: r.reason,
    reason_category: r.reason_category,
    destination_type: r.destination_type,
    dest_address: r.dest_address,
    dest_lat: Number(r.dest_lat),
    dest_lng: Number(r.dest_lng),
    depart_at: iso(r.depart_at),
    expected_return_at: iso(r.expected_return_at),
    request_status: r.status,
    risk_score: r.risk_score,
    risk_level: riskLevel(r.risk_score),
    last_location:
      r.lp_lat != null
        ? {
            lat: Number(r.lp_lat),
            lng: Number(r.lp_lng),
            accuracy: r.lp_accuracy,
            speed: r.lp_speed,
            battery: r.lp_battery,
            recorded_at: iso(r.lp_recorded_at),
          }
        : null,
  };
}

async function listTrips(where = '1=1', params = [], { limit = 50, offset = 0, order = 't.id DESC' } = {}) {
  const rows = await db.query(`${TRIP_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM trips t JOIN outpass_requests o ON o.id = t.request_id ${STUDENT_JOINS} WHERE ${where}`,
    params,
  );
  return { items: rows.map(serializeTrip), total: Number(total) };
}

async function getTrip(id) {
  const r = await db.one(`${TRIP_SELECT} WHERE t.id = ?`, [id]);
  return r ? serializeTrip(r) : null;
}

/** Raw trip + request row for business logic (no serialization). */
async function getTripRaw(id, conn = db) {
  return conn.one(
    `SELECT t.*, o.student_id, o.depart_at, o.expected_return_at, o.dest_lat, o.dest_lng, o.destination_type,
            o.status AS request_status, s.name AS student_name, s.roll_no
     FROM trips t JOIN outpass_requests o ON o.id = t.request_id JOIN users s ON s.id = o.student_id
     WHERE t.id = ?`,
    [id],
  );
}

async function getActiveConsent(tripId, conn = db) {
  return conn.one('SELECT * FROM tracking_consents WHERE trip_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', [tripId]);
}

function serializeConsent(c) {
  if (!c) return null;
  return {
    id: c.id,
    trip_id: c.trip_id,
    student_id: c.student_id,
    scope: c.scope,
    consent_text: c.consent_text,
    granted_at: iso(c.granted_at),
    revoked_at: iso(c.revoked_at),
    revoke_reason: c.revoke_reason,
    active: !c.revoked_at,
  };
}

async function getTripEvents(tripId) {
  const rows = await db.query('SELECT type, occurred_at, data FROM trip_events WHERE trip_id = ? ORDER BY occurred_at, id', [tripId]);
  return rows.map((r) => ({ type: r.type, at: iso(r.occurred_at), data: parseJson(r.data) }));
}

async function getGateLogs(tripId) {
  const rows = await db.query(
    `SELECT g.id, g.trip_id, g.type, g.scanned_at, g.result, g.method, g.note, g.guard_id, u.name AS guard_name
     FROM gate_logs g JOIN users u ON u.id = g.guard_id WHERE g.trip_id = ? ORDER BY g.scanned_at`,
    [tripId],
  );
  return rows.map((g) => ({
    id: g.id,
    trip_id: g.trip_id,
    type: g.type,
    scanned_at: iso(g.scanned_at),
    result: g.result,
    method: g.method,
    note: g.note,
    guard_id: g.guard_id,
    guard: { id: g.guard_id, name: g.guard_name },
  }));
}

/** IDs of students verified-linked to a parent. */
async function linkedStudentIds(parentId) {
  const rows = await db.query('SELECT student_id FROM parent_student_links WHERE parent_id = ? AND verified = 1', [parentId]);
  return rows.map((r) => r.student_id);
}

/** Users verified as parents of a student. */
async function parentsOf(studentId) {
  return db.query(
    `SELECT u.id, u.name, u.phone, u.email, u.push_token FROM parent_student_links l JOIN users u ON u.id = l.parent_id
     WHERE l.student_id = ? AND l.verified = 1 AND u.is_active = 1`,
    [studentId],
  );
}

/** Staff who should hear about a student: the hostel's warden, else all wardens. */
async function wardensFor(studentId) {
  const rows = await db.query(
    `SELECT w.id FROM users s JOIN hostels h ON h.id = s.hostel_id JOIN users w ON w.id = h.warden_id
     WHERE s.id = ? AND w.is_active = 1`,
    [studentId],
  );
  if (rows.length) return rows.map((r) => r.id);
  const all = await db.query("SELECT id FROM users WHERE role = 'warden' AND is_active = 1");
  return all.map((r) => r.id);
}

async function securityUsers() {
  const rows = await db.query("SELECT id FROM users WHERE role = 'security' AND is_active = 1");
  return rows.map((r) => r.id);
}

/** Primary campus fence (lowest id): reference point for distances and the default map view. */
async function getCampusFence() {
  const r = await db.one("SELECT * FROM geofences WHERE type = 'CAMPUS' AND is_active = 1 ORDER BY id LIMIT 1");
  return r ? serializeFence(r) : null;
}

/** All active campus fences (e.g. college + off-site hostel): entering any of them counts as returned. */
async function getCampusFences() {
  const rows = await db.query("SELECT * FROM geofences WHERE type = 'CAMPUS' AND is_active = 1 ORDER BY id");
  return rows.map(serializeFence);
}

function serializeFence(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    shape: r.shape,
    center_lat: Number(r.center_lat),
    center_lng: Number(r.center_lng),
    radius_m: r.radius_m,
    polygon: parseJson(r.polygon),
    trip_id: r.trip_id,
    is_active: !!r.is_active,
    created_at: iso(r.created_at),
  };
}

module.exports = {
  USER_SELECT,
  serializeUser,
  getUser,
  serializeOutpass,
  listOutpasses,
  getOutpass,
  serializeTrip,
  listTrips,
  getTrip,
  getTripRaw,
  getActiveConsent,
  serializeConsent,
  getTripEvents,
  getGateLogs,
  linkedStudentIds,
  parentsOf,
  wardensFor,
  securityUsers,
  getCampusFence,
  getCampusFences,
  serializeFence,
  riskLevel,
  parseJson,
};

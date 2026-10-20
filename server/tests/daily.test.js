/**
 * Daily (recurring) pass integration tests. Same rules as registration.test.js: they only run against a
 * THROWAWAY database named in TEST_DB_NAME (must contain "test"), re-migrated on every run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_DB = process.env.TEST_DB_NAME || '';
const enabled = /test/i.test(TEST_DB);
const SKIP = enabled ? false : 'set TEST_DB_NAME (containing "test") and TEST_DB_HOST/USER/PASSWORD to run DB integration tests';

const PW = 'Secret123';
let server;
let base;
let db;
let daily;
let gate;
let qr;
let config;
const T = {}; // tokens + ids

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = async (id) => (await call('POST', '/api/auth/login', { identifier: id, password: PW })).body.data.accessToken;

/** Local (IST) noon of a date, as the "now" used for generation and gate checks. */
const noon = (date) => new Date(`${date}T12:00:00+05:30`);
/** Sign the QR exactly like GET /trips/:id/qr does for a not-yet-exited daily trip. */
async function qrFor(tripId) {
  const t = await db.one('SELECT id, qr_token_id, window_end FROM trips WHERE id = ?', [tripId]);
  return qr.signQrToken({ tripId: t.id, jti: t.qr_token_id, expiresAt: new Date(new Date(t.window_end).getTime() + 30 * 60_000) }, config.qrSecret);
}
async function gateCode(tripId, now) {
  try {
    const r = await gate.verifyToken(await qrFor(tripId), T.guardId, { now });
    return r.action;
  } catch (err) {
    return err.code;
  }
}

test.before(async () => {
  if (!enabled) return;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    ENABLE_JOBS: 'false',
    DB_HOST: process.env.TEST_DB_HOST || '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT || '3306',
    DB_USER: process.env.TEST_DB_USER || 'root',
    DB_PASSWORD: process.env.TEST_DB_PASSWORD || '',
    DB_NAME: TEST_DB,
    SMS_PROVIDER: 'none',
  });
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate.js'), '--fresh'], { env: process.env, stdio: 'pipe' });
  db = require('../src/db');
  daily = require('../src/services/daily.service');
  gate = require('../src/services/gate.service');
  qr = require('../src/utils/qr');
  config = require('../src/config');
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(PW, 4);
  await db.query("INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m) VALUES ('Main Campus', 'CAMPUS', 'CIRCLE', 11.481, 77.875, 300)");
  const add = async (role, email, roll = null) =>
    (await db.query('INSERT INTO users (role, name, email, password_hash, roll_no) VALUES (?, ?, ?, ?, ?)', [role, `${role} ${email}`, email, hash, roll])).insertId;
  await add('warden', 'warden@test.edu');
  T.guardId = await add('security', 'guard@test.edu');
  T.studentId = await add('student', 'stu@test.edu', '24AI001');
  T.student2Id = await add('student', 'stu2@test.edu', '24AI002');

  const http = require('http');
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  T.student = await login('stu@test.edu');
  T.student2 = await login('stu2@test.edu');
  T.warden = await login('warden@test.edu');
  T.guard = await login('guard@test.edu');

  // Today (D1) and D3 are scheduled; D2 is not.
  T.d1 = daily.localDate();
  T.d2 = daily.addDays(T.d1, 1);
  T.d3 = daily.addDays(T.d1, 2);
  const pass = await call('POST', '/api/outpasses', {
    pass_type: 'DAILY', reason: 'Internship at Tidel Park', reason_category: 'INTERNSHIP', dest_name: 'Tidel Park',
    dest_address: 'Tidel Park, Coimbatore', dest_lat: 11.03, dest_lng: 77.03, start_date: T.d1, end_date: daily.addDays(T.d1, 13),
    days_of_week: [daily.dayOf(T.d1), daily.dayOf(T.d3)], depart_time: '08:00', return_time: '18:00', consent: true,
  }, T.student);
  assert.equal(pass.status, 201, JSON.stringify(pass.body));
  T.passId = pass.body.data.id;
  assert.equal(pass.body.data.pass_type, 'DAILY');
  assert.equal((await call('POST', `/api/outpasses/${T.passId}/approve`, { remarks: 'ok' }, T.warden)).status, 200);
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

test('daily pass validation: times, range, overlap', { skip: SKIP }, async () => {
  const base2 = {
    pass_type: 'DAILY', reason: 'Tuition classes', reason_category: 'TUITION', dest_name: 'Centre', dest_address: 'Somewhere, Coimbatore',
    dest_lat: 11.0, dest_lng: 77.0, start_date: daily.localDate(), end_date: daily.addDays(daily.localDate(), 10), days_of_week: ['MON', 'WED'],
    depart_time: '16:00', return_time: '19:00',
  };
  assert.equal((await call('POST', '/api/outpasses', { ...base2, return_time: '15:00' }, T.student2)).status, 400, 'return before departure');
  assert.equal((await call('POST', '/api/outpasses', { ...base2, end_date: daily.addDays(daily.localDate(), 120) }, T.student2)).status, 400, 'beyond 90 days');
  assert.equal((await call('POST', '/api/outpasses', { ...base2, reason_category: 'HOME_VISIT' }, T.student2)).status, 400, 'one-time category on a daily pass');
  assert.equal((await call('POST', '/api/outpasses', base2, T.student2)).status, 201);
  const overlap = await call('POST', '/api/outpasses', { ...base2, start_date: daily.addDays(daily.localDate(), 5) }, T.student2);
  assert.equal(overlap.status, 409, 'overlapping / second active pass');
});

test('trips are generated only on scheduled weekdays', { skip: SKIP }, async () => {
  for (const d of [T.d1, T.d2, T.d3]) await daily.generateDailyTrips({ now: noon(d), requestId: T.passId });
  const rows = await db.query('SELECT trip_date FROM trips WHERE request_id = ? ORDER BY trip_date', [T.passId]);
  assert.deepEqual(rows.map((r) => daily.toDateStr(r.trip_date)), [T.d1, T.d3]);
  // Each day has its own window (08:00–18:00 local) and its own QR id.
  const [a, b] = await db.query('SELECT window_start, window_end, qr_token_id FROM trips WHERE request_id = ? ORDER BY trip_date', [T.passId]);
  assert.equal(new Date(a.window_start).toISOString(), daily.localToUtc(T.d1, '08:00').toISOString());
  assert.equal(new Date(b.window_end).toISOString(), daily.localToUtc(T.d3, '18:00').toISOString());
  assert.notEqual(a.qr_token_id, b.qr_token_id);
});

test('no duplicate trip for the same date', { skip: SKIP }, async () => {
  const again = await daily.generateDailyTrips({ now: noon(T.d1), requestId: T.passId });
  assert.deepEqual(again, []);
  const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d1]);
  assert.equal(Number(n), 1);
  await assert.rejects(
    db.query("INSERT INTO trips (request_id, trip_date, window_start, window_end, qr_token_id) VALUES (?, ?, NOW(), NOW(), UUID())", [T.passId, T.d1]),
    (e) => e.code === 'ER_DUP_ENTRY',
  );
});

test("today's QR works; yesterday's QR is rejected the next day", { skip: SKIP }, async () => {
  const d1Trip = (await db.one('SELECT id FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d1])).id;
  assert.equal(await gateCode(d1Trip, noon(T.d1)), 'EXIT');
  const nextDay = await gateCode(d1Trip, noon(T.d3));
  assert.ok(['QR_EXPIRED', 'NOT_SCHEDULED_TODAY'].includes(nextDay), `got ${nextDay}`);
  // Outside the day's window (06:00, before 08:00 - 30 min grace) is rejected too.
  assert.equal(await gateCode(d1Trip, new Date(`${T.d1}T06:00:00+05:30`)), 'OUTSIDE_TIME_WINDOW');
  const logged = await db.query("SELECT result FROM gate_logs WHERE trip_id = ? AND result LIKE 'REJECTED_%'", [d1Trip]);
  assert.ok(logged.length >= 2, 'rejections are logged');
});

test('paused or revoked pass is blocked at the gate; resume works again', { skip: SKIP }, async () => {
  const tripId = (await db.one('SELECT id FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d1])).id;
  assert.equal((await call('POST', `/api/outpasses/${T.passId}/pause`, {}, T.student)).status, 200);
  assert.equal(await gateCode(tripId, noon(T.d1)), 'PASS_PAUSED');
  assert.equal((await call('POST', `/api/outpasses/${T.passId}/resume`, {}, T.student)).status, 200);
  assert.equal(await gateCode(tripId, noon(T.d1)), 'EXIT', 'resumed: today works again with the refreshed QR');
  assert.equal((await call('POST', `/api/outpasses/${T.passId}/revoke`, { remarks: 'Internship ended early' }, T.student)).status, 403, 'students cannot revoke');
  // A second pass for student2 is revoked by the warden.
  const p2 = (await call('GET', '/api/outpasses?pass_type=DAILY', null, T.student2)).body.data[0];
  await call('POST', `/api/outpasses/${p2.id}/approve`, {}, T.warden);
  const today2 = daily.dayOf(daily.localDate());
  await db.query('UPDATE outpass_schedules SET days_of_week = ? WHERE request_id = ?', [today2, p2.id]);
  await daily.generateDailyTrips({ requestId: p2.id });
  const trip2 = (await db.one('SELECT id FROM trips WHERE request_id = ?', [p2.id])).id;
  assert.equal((await call('POST', `/api/outpasses/${p2.id}/revoke`, { remarks: 'Not needed' }, T.warden)).status, 200);
  const code = await gateCode(trip2, new Date(`${daily.localDate()}T17:00:00+05:30`));
  assert.equal(code, 'PASS_REVOKED');
  assert.ok(await db.one("SELECT id FROM gate_logs WHERE trip_id = ? AND result = 'REJECTED_PASS_REVOKED'", [trip2]));
});

test('consent: each day trip gets its own consent; revoking stops tracking', { skip: SKIP }, async () => {
  const tripId = (await db.one('SELECT id FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d1])).id;
  assert.ok(await db.one('SELECT id FROM tracking_consents WHERE trip_id = ? AND revoked_at IS NULL', [tripId]), 'day trip has its own consent');
  // Put today's window around the real clock so tracking is inside it, then exit at the gate.
  await db.query('UPDATE trips SET window_start = ?, window_end = ? WHERE id = ?', [new Date(Date.now() - 3600e3), new Date(Date.now() + 2 * 3600e3), tripId]);
  const v = await gate.verifyToken(await qrFor(tripId), T.guardId);
  await gate.record(v.raw, 'EXIT', T.guardId);
  const ping = () => call('POST', `/api/trips/${tripId}/location`, { lat: 11.4, lng: 77.8, accuracy: 15 }, T.student);
  assert.equal((await ping()).status, 200, 'tracking allowed while ACTIVE + consented');
  assert.equal((await call('DELETE', `/api/outpasses/${T.passId}/consent`, null, T.student)).status, 200);
  const blocked = await ping();
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.details.reason, 'NO_CONSENT');
  // Days generated after the pass consent was revoked have no consent.
  await db.query('DELETE FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d3]);
  await daily.generateDailyTrips({ now: noon(T.d3), requestId: T.passId });
  const d3 = await db.one('SELECT id FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d3]);
  assert.equal(await db.one('SELECT id FROM tracking_consents WHERE trip_id = ?', [d3.id]), null);
  // Finish today's trip so it does not affect the next tests.
  const back = await gate.verifyToken(await qrFor(tripId), T.guardId);
  await gate.record(back.raw, 'ENTRY', T.guardId);
  const pass = await db.one('SELECT status FROM outpass_requests WHERE id = ?', [T.passId]);
  assert.equal(pass.status, 'APPROVED', 'completing one day does not complete the whole pass');
});

test('missed day becomes NO_SHOW, never OVERDUE', { skip: SKIP }, async () => {
  const { runExpiry } = require('../src/jobs/monitor.jobs');
  const { runOverdueCheck } = require('../src/jobs/overdue.job');
  const d3 = await db.one('SELECT id, window_end FROM trips WHERE request_id = ? AND trip_date = ?', [T.passId, T.d3]);
  const after = new Date(new Date(d3.window_end).getTime() + 3 * 3600e3);
  await runOverdueCheck({ now: after });
  await runExpiry(after);
  const t = await db.one('SELECT status, escalation_level FROM trips WHERE id = ?', [d3.id]);
  assert.equal(t.status, 'NO_SHOW');
  assert.equal(t.escalation_level, 0);
  const report = await call('GET', `/api/reports/daily-passes?from=${T.d1}&to=${T.d3}`, null, T.warden);
  assert.equal(report.status, 200);
  const row = report.body.data.per_pass.find((p) => p.id === T.passId);
  assert.ok(row.no_show >= 1 && row.completed >= 1, JSON.stringify(row));
});

test('one-time trips are unchanged', { skip: SKIP }, async () => {
  const op = await call('POST', '/api/outpasses', {
    reason: 'Dental appointment', reason_category: 'MEDICAL', destination_type: 'OTHER', dest_address: 'Clinic, Erode',
    dest_lat: 11.34, dest_lng: 77.71, depart_at: new Date(Date.now() + 5 * 60e3).toISOString(), expected_return_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  }, T.student2);
  assert.equal(op.status, 201);
  assert.equal(op.body.data.pass_type, 'ONE_TIME');
  const ap = await call('POST', `/api/outpasses/${op.body.data.id}/approve`, {}, T.warden);
  const trip = ap.body.data.trip;
  assert.equal(new Date(trip.window_start).toISOString(), op.body.data.depart_at, 'window = request times');
  const token = (await call('GET', `/api/trips/${trip.id}/qr`, null, T.student2)).body.data.token;
  assert.equal((await call('POST', '/api/gate/scan', { token }, T.guard)).body.data.action, 'EXIT');
  assert.equal((await db.one('SELECT status FROM outpass_requests WHERE id = ?', [op.body.data.id])).status, 'ACTIVE');
  assert.equal((await call('POST', '/api/gate/scan', { token }, T.guard)).body.data.trip.status, 'COMPLETED');
  assert.equal((await db.one('SELECT status FROM outpass_requests WHERE id = ?', [op.body.data.id])).status, 'COMPLETED');
  assert.equal((await call('POST', '/api/gate/scan', { token }, T.guard)).body.error.code, 'QR_ALREADY_USED');
});

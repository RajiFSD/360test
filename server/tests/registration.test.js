/**
 * Integration tests for self-registration + admin approval.
 *
 * They need a THROWAWAY database and never use the one in server/.env:
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=... TEST_DB_NAME=smartoutpass_test npm test
 * The database name must contain "test"; it is dropped and re-migrated on every run. Skipped when not configured.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_DB = process.env.TEST_DB_NAME || '';
const enabled = /test/i.test(TEST_DB);
const SKIP = enabled ? false : 'set TEST_DB_NAME (containing "test") and TEST_DB_HOST/USER/PASSWORD to run DB integration tests';

let server;
let base;
let db;
let ids = {};

const PW = 'Secret123';
const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = (identifier, password = PW) => call('POST', '/api/auth/login', { identifier, password });
const student = (over = {}) => ({
  role: 'student', name: 'Kavin R', roll_no: '24AI100', email: 'kavin@test.edu', phone: '9876543210',
  department_id: ids.dept, hostel_id: ids.hostel, password: PW, confirm_password: PW, ...over,
});
const parent = (over = {}) => ({
  role: 'parent', name: 'Ravi R', email: 'ravi@test.edu', phone: '+91 9123456780',
  children: [{ roll_no: '24AI001', relation: 'Father' }], password: PW, confirm_password: PW, ...over,
});

test.before(async () => {
  if (!enabled) return;
  // Point everything at the test database BEFORE any app module reads config.
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
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(PW, 4);
  ids.dept = (await db.query("INSERT INTO departments (name, code) VALUES ('AI & Data Science', '10058')")).insertId;
  ids.hostel = (await db.query("INSERT INTO hostels (name) VALUES ('College Hostel')")).insertId;
  ids.admin = (await db.query(
    "INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Admin', 'admin@test.edu', ?)", [hash],
  )).insertId;
  ids.existingStudent = (await db.query(
    "INSERT INTO users (role, name, email, phone, password_hash, roll_no, department_id, hostel_id) VALUES ('student', 'Existing Student', 'existing@test.edu', '+919000000001', ?, '24AI001', ?, ?)",
    [hash, ids.dept, ids.hostel],
  )).insertId;

  const http = require('http');
  const { createApp } = require('../src/app');
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  ids.adminToken = (await login('admin@test.edu')).body.data.accessToken;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

test('registration cannot create staff or admin accounts, even with a forged role', { skip: SKIP }, async () => {
  for (const role of ['admin', 'warden', 'faculty', 'security', 'ADMIN', '', undefined]) {
    const email = `forged-${role || 'none'}@test.edu`;
    const r = await call('POST', '/api/auth/register', { ...student({ email, roll_no: `24AI9${Math.floor(Math.random() * 90 + 10)}`, phone: '9811111111' }), role });
    assert.equal(r.status, 400, `role=${role}`);
    assert.equal(await db.one('SELECT id FROM users WHERE email = ?', [email]), null, `no user created for role=${role}`);
  }
  // Extra privileged fields are ignored: still a pending, inactive student.
  const r = await call('POST', '/api/auth/register', {
    ...student({ email: 'sneaky@test.edu', roll_no: '24AI555', phone: '9822222222' }),
    is_active: 1, registration_status: 'APPROVED', must_change_password: 0, id: 1, department: 'x',
  });
  assert.equal(r.status, 201);
  const u = await db.one('SELECT role, is_active, registration_status FROM users WHERE email = ?', ['sneaky@test.edu']);
  assert.deepEqual({ ...u }, { role: 'student', is_active: 0, registration_status: 'PENDING' });
});

test('field validation: phone, roll number, password strength, matching passwords', { skip: SKIP }, async () => {
  const bad = [
    [{ phone: '12345' }, 'phone'],
    [{ phone: '5876543210' }, 'phone'], // Indian mobiles start 6-9
    [{ roll_no: 'ab' }, 'roll_no'],
    [{ password: 'onlyletters', confirm_password: 'onlyletters' }, 'password'],
    [{ password: 'short1', confirm_password: 'short1' }, 'password'],
    [{ confirm_password: 'Different1' }, 'confirm_password'],
    [{ email: 'not-an-email' }, 'email'],
  ];
  for (const [over, field] of bad) {
    const r = await call('POST', '/api/auth/register', student({ email: 'v@test.edu', roll_no: '24AI777', phone: '9833333333', ...over }));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.ok(r.body.error.details.some((d) => d.path === field), `expected error on ${field}: ${JSON.stringify(r.body.error.details)}`);
  }
  assert.equal((await call('POST', '/api/auth/register', student({ email: 'v@test.edu', roll_no: '24AI777', phone: '+91 98333-33333' }))).status, 201);
});

test('a PENDING user cannot log in; an approved one can; a rejected one sees the reason', { skip: SKIP }, async () => {
  assert.equal((await call('POST', '/api/auth/register', student())).status, 201);
  const pending = await login('24AI100');
  assert.equal(pending.status, 403);
  assert.equal(pending.body.error.code, 'ACCOUNT_PENDING');
  assert.match(pending.body.error.message, /awaiting approval/);
  // Wrong password never reveals the pending state.
  assert.equal((await login('24AI100', 'Wrong1234')).body.error.code, 'INVALID_CREDENTIALS');

  const u = await db.one('SELECT id FROM users WHERE roll_no = ?', ['24AI100']);
  const list = await call('GET', '/api/admin/registrations', null, ids.adminToken);
  assert.ok(list.body.data.some((r) => r.id === u.id));
  assert.equal((await call('POST', `/api/admin/registrations/${u.id}/approve`, {}, ids.adminToken)).status, 200);
  const okLogin = await login('24AI100');
  assert.equal(okLogin.status, 200);
  assert.equal(okLogin.body.data.user.role, 'student');
  const n = await db.one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'REGISTRATION_APPROVED'", [u.id]);
  assert.ok(Number(n.n) >= 1, 'user notified on approval');

  assert.equal((await call('POST', '/api/auth/register', student({ email: 'rej@test.edu', roll_no: '24AI300', phone: '9844444444' }))).status, 201);
  const rej = await db.one('SELECT id FROM users WHERE roll_no = ?', ['24AI300']);
  assert.equal((await call('POST', `/api/admin/registrations/${rej.id}/reject`, { reason: 'Not a current student' }, ids.adminToken)).status, 200);
  const rl = await login('24AI300');
  assert.equal(rl.body.error.code, 'ACCOUNT_REJECTED');
  assert.match(rl.body.error.message, /Not a current student/);
  const audits = await db.query("SELECT action FROM audit_logs WHERE entity_id IN (?, ?) ORDER BY id", [String(u.id), String(rej.id)]);
  for (const a of ['REGISTRATION_SUBMITTED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED']) {
    assert.ok(audits.some((x) => x.action === a), `audit ${a}`);
  }
});

test('duplicate email, phone and roll number are rejected with one generic message', { skip: SKIP }, async () => {
  const fresh = { email: 'unique@test.edu', roll_no: '24AI400', phone: '9855555555' };
  const cases = [
    { ...fresh, email: 'EXISTING@test.edu' }, // existing email, different case
    { ...fresh, phone: '+91-90000-00001' }, // existing phone, different formatting
    { ...fresh, roll_no: '24ai001' }, // existing roll number, different case
  ];
  const messages = new Set();
  for (const c of cases) {
    const r = await call('POST', '/api/auth/register', student(c));
    assert.equal(r.status, 409, JSON.stringify(c));
    assert.equal(r.body.error.code, 'REGISTRATION_CONFLICT');
    messages.add(r.body.error.message);
  }
  assert.equal(messages.size, 1, 'same message whichever field collided');
  assert.doesNotMatch([...messages][0], /email|phone|roll/i);
});

test('parent: unknown roll numbers are accepted silently; unverified link shows no student data', { skip: SKIP }, async () => {
  const withUnknown = await call('POST', '/api/auth/register', parent({
    children: [{ roll_no: '24AI001', relation: 'Father' }, { roll_no: '99ZZ999', relation: 'Guardian' }],
  }));
  const onlyUnknown = await call('POST', '/api/auth/register', parent({ email: 'p2@test.edu', phone: '9866666666', children: [{ roll_no: '88YY888', relation: 'Mother' }] }));
  assert.equal(withUnknown.status, 201);
  assert.equal(onlyUnknown.status, 201);
  assert.deepEqual(withUnknown.body, onlyUnknown.body, 'response never reveals which roll numbers exist');

  const p = await db.one('SELECT id FROM users WHERE email = ?', ['ravi@test.edu']);
  const links = await db.query('SELECT student_id, verified FROM parent_student_links WHERE parent_id = ?', [p.id]);
  assert.deepEqual(links.map((l) => ({ ...l })), [{ student_id: ids.existingStudent, verified: 0 }], 'one unverified link, none for the unknown roll');

  await call('POST', `/api/admin/registrations/${p.id}/approve`, {}, ids.adminToken);
  const token = (await login('ravi@test.edu')).body.data.accessToken;
  assert.deepEqual((await call('GET', '/api/parent/students', null, token)).body.data, []);
  assert.deepEqual((await call('GET', '/api/outpasses', null, token)).body.data, []);
  assert.deepEqual((await call('GET', '/api/trips', null, token)).body.data, []);
  assert.equal((await call('GET', `/api/users/${ids.existingStudent}`, null, token)).status, 403);

  // Approval did not verify the link; once the admin verifies it, the student appears.
  const link = await db.one('SELECT id FROM parent_student_links WHERE parent_id = ?', [p.id]);
  await call('PATCH', `/api/admin/links/${link.id}`, { verified: true }, ids.adminToken);
  const after = (await call('GET', '/api/parent/students', null, token)).body.data;
  assert.equal(after.length, 1);
  assert.equal(after[0].student.roll_no, '24AI001');
});

test('public registration options and admin pending count', { skip: SKIP }, async () => {
  const o = await call('GET', '/api/auth/register/options');
  assert.equal(o.status, 200);
  assert.deepEqual(o.body.data.relations, ['Father', 'Mother', 'Guardian']);
  assert.ok(o.body.data.departments.length >= 1 && o.body.data.hostels.length >= 1);
  const c = await call('GET', '/api/admin/registrations/count', null, ids.adminToken);
  assert.equal(typeof c.body.data.pending, 'number');
  const s = (await login('existing@test.edu')).body.data.accessToken;
  assert.equal((await call('GET', '/api/admin/registrations', null, s)).status, 403, 'students cannot see registrations');
});

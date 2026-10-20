#!/usr/bin/env node
/**
 * Real base data for a production install (no demo data).
 *
 *   npm run seed:minimal                       idempotent: upsert admin, campus geofence(s), hostels, departments
 *   npm run seed:minimal -- --wipe=CONFIRM     ALSO delete all activity data and ALL users first (take a backup!)
 *   npm run seed:minimal -- --reset-admin-password   re-apply ADMIN_PASSWORD to an existing admin
 *
 * Inputs
 *   server/.env                  ADMIN_EMAIL, ADMIN_PASSWORD (never hardcoded, never printed), optional ADMIN_NAME
 *   server/config/base-data.json admin name, campus geofences (college, hostel…), hostels, departments (see base-data.example.json)
 *
 * Hostels and departments are synced to EXACTLY the configured lists (others are deleted; users that referenced
 * them keep their account with the field cleared). The admin account is exempt from forced password change.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const config = require('../src/config');

const CONFIG_PATH = process.env.BASE_DATA_PATH || path.join(__dirname, '..', 'config', 'base-data.json');
const WIPE = process.argv.includes('--wipe=CONFIRM');
const RESET_ADMIN_PASSWORD = process.argv.includes('--reset-admin-password');
if (process.argv.some((a) => a.startsWith('--wipe') && a !== '--wipe=CONFIRM')) {
  console.error('Refusing: to wipe data pass exactly --wipe=CONFIRM');
  process.exit(1);
}

// Child tables first so foreign keys stay satisfied with FOREIGN_KEY_CHECKS left ON.
const WIPE_ORDER = [
  'location_pings',
  'trip_events',
  'tracking_consents',
  'gate_logs',
  'notifications',
  'geofences:trip', // only trip-specific (destination) fences
  'trips',
  'outpass_requests',
  'ai_trip_samples',
  'parent_student_links',
  'refresh_tokens',
  'audit_logs',
];
const RESET_AUTO_INCREMENT = [
  'location_pings', 'trip_events', 'tracking_consents', 'gate_logs', 'notifications', 'trips', 'outpass_requests',
  'ai_trip_samples', 'parent_student_links', 'refresh_tokens', 'audit_logs', 'users', 'hostels', 'departments', 'geofences',
];

function fail(msg) {
  console.error(`[seed:minimal] ${msg}`);
  process.exit(1);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`Missing ${path.relative(process.cwd(), CONFIG_PATH)}. Copy config/base-data.example.json to config/base-data.json and fill in your values.`);
  }
  let c;
  try {
    c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    fail(`base-data.json is not valid JSON: ${err.message}`);
  }
  const problems = [];
  const placeholder = (v) => typeof v === 'string' && /[<>]/.test(v);
  const adminName = (c.admin?.name || process.env.ADMIN_NAME || '').trim();
  if (adminName.length < 2 || placeholder(adminName)) problems.push('admin.name (or ADMIN_NAME in .env) must be a real name');

  // "campuses": one or more return points (e.g. college + off-site hostel); a single "campus" object also works.
  const rawCampuses = Array.isArray(c.campuses) ? c.campuses : c.campus ? [c.campus] : [];
  if (!rawCampuses.length) problems.push('campuses must list at least one { name, lat, lng, radius_m }');
  const campuses = rawCampuses.map((campus, i) => {
    const label = `campuses[${i}]`;
    const lat = Number(campus.lat);
    const lng = Number(campus.lng);
    const radius = Number(campus.radius_m);
    const name = String(campus.name || (i === 0 ? 'Main Campus' : `Campus ${i + 1}`)).trim();
    if (placeholder(name)) problems.push(`${label}.name still contains a <placeholder>`);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) problems.push(`${label}.lat must be a number between -90 and 90`);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) problems.push(`${label}.lng must be a number between -180 and 180`);
    if (!Number.isInteger(radius) || radius < 50 || radius > 20000) problems.push(`${label}.radius_m must be a whole number of metres (50–20000)`);
    return { name, lat, lng, radius };
  });
  if (new Set(campuses.map((x) => x.name.toLowerCase())).size !== campuses.length) problems.push('campus names must be unique');

  const hostels = (c.hostels || []).map((h) => String(h).trim()).filter(Boolean);
  if (!hostels.length) problems.push('hostels must list at least one hostel name');
  if (new Set(hostels.map((h) => h.toLowerCase())).size !== hostels.length) problems.push('hostels contains duplicates');
  if (hostels.some(placeholder)) problems.push('hostels still contains <placeholders>');

  const departments = (c.departments || []).map((d) => ({ name: String(d.name || '').trim(), code: String(d.code || '').trim().toUpperCase() }));
  if (!departments.length) problems.push('departments must list at least one { name, code }');
  if (departments.some((d) => d.name.length < 2 || !d.code || d.code.length > 20)) problems.push('every department needs a name and a code (max 20 chars)');
  if (departments.some((d) => placeholder(d.name) || placeholder(d.code))) problems.push('departments still contain <placeholders>');
  if (new Set(departments.map((d) => d.code)).size !== departments.length) problems.push('department codes must be unique');
  if (new Set(departments.map((d) => d.name.toLowerCase())).size !== departments.length) problems.push('department names must be unique');

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('ADMIN_EMAIL in server/.env is missing or invalid');
  if (password.length < 8) problems.push('ADMIN_PASSWORD in server/.env must be at least 8 characters');

  if (problems.length) fail(`Fix these in base-data.json / .env:\n  - ${problems.join('\n  - ')}`);
  return {
    admin: { name: adminName, email, password },
    campuses,
    hostels,
    departments,
  };
}

async function counts() {
  const tables = ['users', 'departments', 'hostels', 'geofences', ...WIPE_ORDER.filter((t) => !t.includes(':'))];
  const out = {};
  for (const t of [...new Set(tables)]) out[t] = Number((await db.one(`SELECT COUNT(*) AS n FROM \`${t}\``)).n);
  return out;
}

async function syncDepartments(tx, departments, { explicitIds }) {
  if (explicitIds) {
    await tx.query('DELETE FROM departments');
    for (let i = 0; i < departments.length; i++) {
      await tx.query('INSERT INTO departments (id, name, code) VALUES (?, ?, ?)', [i + 1, departments[i].name, departments[i].code]);
    }
    return;
  }
  const existing = await tx.query('SELECT id, name, code FROM departments');
  const keep = [];
  for (const d of departments) {
    const match = existing.find((e) => e.code.toUpperCase() === d.code || e.name.toLowerCase() === d.name.toLowerCase());
    if (match) {
      await tx.query('UPDATE departments SET name = ?, code = ? WHERE id = ?', [d.name, d.code, match.id]);
      keep.push(match.id);
    } else {
      keep.push((await tx.query('INSERT INTO departments (name, code) VALUES (?, ?)', [d.name, d.code])).insertId);
    }
  }
  await tx.query('DELETE FROM departments WHERE id NOT IN (?)', [keep]);
}

async function syncHostels(tx, hostels, { explicitIds }) {
  if (explicitIds) {
    await tx.query('DELETE FROM hostels');
    for (let i = 0; i < hostels.length; i++) await tx.query('INSERT INTO hostels (id, name) VALUES (?, ?)', [i + 1, hostels[i]]);
    return;
  }
  const existing = await tx.query('SELECT id, name FROM hostels');
  const keep = [];
  for (const name of hostels) {
    const match = existing.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (match) {
      await tx.query('UPDATE hostels SET name = ? WHERE id = ?', [name, match.id]);
      keep.push(match.id);
    } else {
      keep.push((await tx.query('INSERT INTO hostels (name) VALUES (?)', [name])).insertId);
    }
  }
  await tx.query('DELETE FROM hostels WHERE id NOT IN (?)', [keep]);
}

/** First entry updates the primary campus fence; others match by name or are inserted. Unlisted campus fences are deactivated. */
async function syncCampuses(tx, campuses) {
  const existing = await tx.query("SELECT id, name FROM geofences WHERE type = 'CAMPUS' AND trip_id IS NULL ORDER BY is_active DESC, id");
  const keep = [];
  for (let i = 0; i < campuses.length; i++) {
    const campus = campuses[i];
    const match =
      existing.find((e) => !keep.includes(e.id) && e.name.toLowerCase() === campus.name.toLowerCase()) ||
      (i === 0 ? existing.find((e) => !keep.includes(e.id)) : null);
    if (match) {
      await tx.query(
        "UPDATE geofences SET name = ?, shape = 'CIRCLE', center_lat = ?, center_lng = ?, radius_m = ?, polygon = NULL, is_active = 1 WHERE id = ?",
        [campus.name, campus.lat, campus.lng, campus.radius, match.id],
      );
      keep.push(match.id);
    } else {
      // Explicit id = next free one, so ids stay compact after a wipe.
      const { next } = await tx.one('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM geofences');
      await tx.query(
        "INSERT INTO geofences (id, name, type, shape, center_lat, center_lng, radius_m, is_active) VALUES (?, ?, 'CAMPUS', 'CIRCLE', ?, ?, ?, 1)",
        [next, campus.name, campus.lat, campus.lng, campus.radius],
      );
      keep.push(next);
    }
  }
  await tx.query("UPDATE geofences SET is_active = 0 WHERE type = 'CAMPUS' AND id NOT IN (?)", [keep]);
}

async function upsertAdmin(tx, admin, { explicitId }) {
  const existing = await tx.one('SELECT id FROM users WHERE email = ?', [admin.email]);
  if (existing) {
    const fields = ["role = 'admin'", 'name = ?', 'is_active = 1', 'must_change_password = 0'];
    const params = [admin.name];
    if (RESET_ADMIN_PASSWORD) {
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(admin.password, config.bcryptRounds));
    }
    await tx.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, existing.id]);
    return { id: existing.id, created: false };
  }
  const hash = await bcrypt.hash(admin.password, config.bcryptRounds);
  const r = await tx.query(
    `INSERT INTO users (${explicitId ? 'id, ' : ''}role, name, email, password_hash, is_active, must_change_password)
     VALUES (${explicitId ? '1, ' : ''}'admin', ?, ?, ?, 1, 0)`,
    [admin.name, admin.email, hash],
  );
  return { id: explicitId ? 1 : r.insertId, created: true };
}

async function main() {
  const base = loadConfig();
  console.log(`[seed:minimal] database ${config.db.database}@${config.db.host} · mode: ${WIPE ? 'WIPE + seed' : 'idempotent upsert'}`);
  const before = await counts();

  const admin = await db.transaction(async (tx) => {
    if (WIPE) {
      for (const t of WIPE_ORDER) {
        if (t === 'geofences:trip') await tx.query('DELETE FROM geofences WHERE trip_id IS NOT NULL');
        else await tx.query(`DELETE FROM \`${t}\``);
      }
      await tx.query('UPDATE hostels SET warden_id = NULL');
      await tx.query('DELETE FROM users');
    }
    await syncDepartments(tx, base.departments, { explicitIds: WIPE });
    await syncHostels(tx, base.hostels, { explicitIds: WIPE });
    await syncCampuses(tx, base.campuses);
    return upsertAdmin(tx, base.admin, { explicitId: WIPE });
  });

  if (WIPE) {
    // DDL implicitly commits, so it runs after the data transaction. InnoDB sets the counter to MAX(id)+1.
    for (const t of RESET_AUTO_INCREMENT) await db.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
  }

  await db.query("INSERT INTO audit_logs (actor_id, action, entity, details) VALUES (?, ?, 'system', ?)", [
    admin.id,
    WIPE ? 'SYSTEM_RESET_REAL_DATA' : 'BASE_DATA_SYNCED',
    JSON.stringify({ hostels: base.hostels.length, departments: base.departments.length, campuses: base.campuses }),
  ]);

  const after = await counts();
  console.log(`[seed:minimal] admin ${admin.created ? 'created' : 'already existed (updated name/role)'}: ${base.admin.email} (id ${admin.id})`);
  console.table(Object.keys(after).map((t) => ({ table: t, before: before[t], after: after[t] })));
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    console.error('[seed:minimal] failed — nothing was changed by the failed transaction:', err.message);
    await db.close();
    process.exit(1);
  });

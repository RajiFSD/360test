#!/usr/bin/env node
/**
 * Seeds demo data (wipes existing rows first):
 *  - departments, hostels, the campus geofence ("Main Campus", 500 m circle in Coimbatore)
 *  - demo users for every role (password: Password@123)
 *  - 2,000+ historical completed trips (requests, trips, gate logs, events) + matching ai_trip_samples
 *  - trains the delay model, then creates a live demo state: pending requests (with AI risk),
 *    an approved pass waiting at the gate, active tracked trips and an overdue trip.
 *
 * Usage: node scripts/seed.js [--trips=2000]
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const config = require('../src/config');
const { haversine } = require('../src/utils/geo');
const { local } = require('../src/services/ai/features');

const TRIPS = Number((process.argv.find((a) => a.startsWith('--trips=')) || '').split('=')[1]) || 2000;
const PASSWORD = 'Password@123';

// ---------- deterministic RNG ----------
let seed = 20261020;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const expo = (mean) => -Math.log(1 - rand()) * mean;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------- reference data ----------
// Campus = the institution's existing "Main Campus" geofence (Coimbatore, 500 m circle).
const CAMPUS = { name: 'Main Campus', lat: 11.0168, lng: 76.9558, radius_m: 500 };
const GATE = { lat: CAMPUS.lat - 0.0040, lng: CAMPUS.lng }; // south gate, ~445 m from centre: just inside the fence

const HOME_CITIES = [
  ['Erode', 11.3410, 77.7172], ['Tiruppur', 11.1085, 77.3411], ['Pollachi', 10.6609, 77.0048], ['Salem', 11.6643, 78.1460],
  ['Palakkad', 10.7867, 76.6548], ['Ooty', 11.4102, 76.6950], ['Madurai', 9.9252, 78.1198], ['Karur', 10.9601, 78.0766],
  ['Dindigul', 10.3673, 77.9803], ['Mettupalayam', 11.2991, 76.9348], ['Thrissur', 10.5276, 76.2144], ['Kochi', 9.9312, 76.2673],
  ['Tiruchirappalli', 10.7905, 78.7047], ['Namakkal', 11.2189, 78.1674], ['Udumalaipettai', 10.5855, 77.2473], ['Kozhikode', 11.2588, 75.7804],
  ['Chennai', 13.0827, 80.2707], ['Bengaluru', 12.9716, 77.5946], ['Mysuru', 12.2958, 76.6394], ['Thanjavur', 10.7870, 79.1378],
  ['Gobichettipalayam', 11.4553, 77.4422], ['Sathyamangalam', 11.5048, 77.2384], ['Kanyakumari', 8.0883, 77.5385],
];
const LOCAL_SPOTS = [
  ['Brookefields Mall', 11.0090, 76.9600], ['Gandhipuram Central Bus Stand', 11.0183, 76.9673], ['PSG Hospitals, Peelamedu', 11.0247, 77.0026],
  ['RS Puram', 11.0089, 76.9469], ['Town Hall', 10.9946, 76.9619], ['Prozone Mall, Saravanampatti', 11.0526, 76.9940],
  ['Race Course', 11.0010, 76.9750], ['KMCH Hospital, Avinashi Rd', 11.0442, 77.0410], ['Coimbatore Junction', 10.9965, 76.9672],
  ['Ukkadam', 10.9890, 76.9610], ['Marudhamalai Temple', 11.0466, 76.8530], ['Fun Mall, Avinashi Rd', 11.0240, 77.0100],
];
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Ananya', 'Diya', 'Aadhya', 'Saanvi',
  'Kavya', 'Meera', 'Priya', 'Sneha', 'Nikhil', 'Rahul', 'Karthik', 'Varun', 'Pooja', 'Divya', 'Harsha', 'Lakshmi', 'Manoj', 'Neha', 'Tejas', 'Shreya'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Rao', 'Gowda', 'Patel', 'Menon', 'Kumar', 'Shetty', 'Hegde', 'Pillai', 'Naidu', 'Bhat', 'Kulkarni'];
const REASONS = {
  HOME_VISIT: ['Weekend home visit', 'Visiting parents', 'Going home for the long weekend', 'Home visit after exams'],
  MEDICAL: ['Dental appointment', 'Eye check-up', 'Follow-up at hospital', 'Physiotherapy session', 'Blood test at diagnostic lab'],
  FAMILY_EVENT: ["Cousin's wedding", "Sister's engagement", "Grandmother's birthday", 'House-warming ceremony', 'Family function'],
  ACADEMIC: ['Hackathon at partner college', 'Internship interview', 'Library visit at IISc', 'Paper presentation', 'Project material purchase'],
  PERSONAL: ['Bank work', 'Passport office appointment', 'Meeting a friend', 'Phone repair', 'Driving licence test'],
  SHOPPING: ['Buying lab coat and stationery', 'Clothes shopping', 'Groceries', 'Buying books', 'Electronics purchase'],
  OTHER: ['Temple visit', 'Sports tournament', 'NSS activity', 'Volunteering event'],
};

const toSql = (d) => new Date(d);
async function bulkInsert(table, cols, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ?`, [part]);
  }
}

async function wipe() {
  const tables = ['location_pings', 'trip_events', 'tracking_consents', 'gate_logs', 'notifications', 'geofences', 'ai_trip_samples', 'trips',
    'outpass_requests', 'parent_student_links', 'refresh_tokens', 'audit_logs', 'settings'];
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await db.query(`TRUNCATE TABLE ${t}`);
  await db.query('UPDATE hostels SET warden_id = NULL');
  await db.query('TRUNCATE TABLE users');
  await db.query('TRUNCATE TABLE hostels');
  await db.query('TRUNCATE TABLE departments');
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function main() {
  console.log(`[seed] database ${config.db.database}@${config.db.host} — wiping and seeding (${TRIPS} historical trips)`);
  await wipe();
  const hash = await bcrypt.hash(PASSWORD, config.bcryptRounds);

  // ---------- departments & hostels ----------
  await bulkInsert('departments', ['id', 'name', 'code'], [
    [1, 'Computer Science & Engineering', 'CSE'], [2, 'Electronics & Communication', 'ECE'], [3, 'Mechanical Engineering', 'MECH'],
    [4, 'Civil Engineering', 'CIVIL'], [5, 'Electrical & Electronics', 'EEE'],
  ]);
  await bulkInsert('hostels', ['id', 'name'], [[1, 'Boys Hostel A'], [2, 'Boys Hostel B'], [3, 'Girls Hostel C']]);

  // ---------- users ----------
  const users = [];
  let id = 1;
  const add = (u) => {
    const row = { id: id++, phone: null, roll_no: null, department_id: null, hostel_id: null, ...u };
    users.push(row);
    return row;
  };
  const admin = add({ role: 'admin', name: 'Asha Admin', email: 'admin@smartoutpass.edu', phone: '+919900000001' });
  const warden = add({ role: 'warden', name: 'Dr. Meera Iyer', email: 'warden@smartoutpass.edu', phone: '+919900000002', hostel_id: 1 });
  const warden2 = add({ role: 'warden', name: 'Prof. Ravi Kumar', email: 'warden2@smartoutpass.edu', phone: '+919900000003', hostel_id: 2 });
  const warden3 = add({ role: 'warden', name: 'Dr. Sunita Rao', email: 'warden3@smartoutpass.edu', phone: '+919900000004', hostel_id: 3 });
  add({ role: 'faculty', name: 'Prof. Anil Hegde', email: 'faculty@smartoutpass.edu', phone: '+919900000005', department_id: 1 });
  const guard = add({ role: 'security', name: 'Ramesh (Main Gate)', email: 'security@smartoutpass.edu', phone: '+919900000006' });
  const guard2 = add({ role: 'security', name: 'Suresh (Night Shift)', email: 'security2@smartoutpass.edu', phone: '+919900000007' });

  const students = [];
  for (let i = 1; i <= 60; i++) {
    const female = i % 3 === 0;
    const first = female ? pick(['Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Kavya', 'Meera', 'Priya', 'Sneha', 'Pooja', 'Divya', 'Lakshmi', 'Neha', 'Shreya']) : pick(FIRST.filter((n) => !['Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Kavya', 'Meera', 'Priya', 'Sneha', 'Pooja', 'Divya', 'Lakshmi', 'Neha', 'Shreya'].includes(n)));
    const name = i === 1 ? 'Aarav Sharma' : `${first} ${pick(LAST)}`;
    const roll = `S2024${String(i).padStart(3, '0')}`;
    const home = i === 1 ? HOME_CITIES[0] : pick(HOME_CITIES);
    const s = add({
      role: 'student',
      name,
      email: `student${i}@smartoutpass.edu`,
      phone: `+91980000${String(i).padStart(4, '0')}`,
      roll_no: roll,
      department_id: ((i - 1) % 5) + 1,
      hostel_id: female ? 3 : i % 2 ? 1 : 2,
      photo_url: `https://i.pravatar.cc/300?u=${roll}`,
    });
    // Latent lateness propensity: most students punctual, a few habitual late returners.
    s.propensity = i === 1 ? 0.2 : rand() < 0.12 ? between(0.55, 0.9) : between(0.02, 0.35);
    s.home = { name: home[0], lat: home[1] + between(-0.01, 0.01), lng: home[2] + between(-0.01, 0.01) };
    students.push(s);
  }
  const parents = [];
  for (let i = 1; i <= 45; i++) {
    const student = students[i - 1];
    const last = student.name.split(' ').slice(-1)[0];
    parents.push(add({
      role: 'parent',
      name: i === 1 ? 'Rajesh Sharma' : `${pick(['Ramesh', 'Suresh', 'Lakshmi', 'Geetha', 'Prakash', 'Vani', 'Mohan', 'Usha'])} ${last}`,
      email: `parent${i}@smartoutpass.edu`,
      phone: `+91970000${String(i).padStart(4, '0')}`,
    }));
  }
  await bulkInsert(
    'users',
    ['id', 'role', 'name', 'email', 'phone', 'password_hash', 'roll_no', 'department_id', 'hostel_id', 'photo_url'],
    users.map((u) => [u.id, u.role, u.name, u.email, u.phone, hash, u.roll_no, u.department_id, u.hostel_id, u.photo_url || null]),
  );
  await db.query('UPDATE hostels SET warden_id = ? WHERE id = 1', [warden.id]);
  await db.query('UPDATE hostels SET warden_id = ? WHERE id = 2', [warden2.id]);
  await db.query('UPDATE hostels SET warden_id = ? WHERE id = 3', [warden3.id]);

  // parent i -> student i; parent1 also has student2 (siblings); parents 44-45 unverified to demo admin verification
  const links = parents.map((p, i) => [p.id, students[i].id, i % 2 ? 'Mother' : 'Father', i >= 43 ? 0 : 1, i >= 43 ? null : admin.id, i >= 43 ? null : new Date()]);
  links.push([parents[0].id, students[1].id, 'Father', 1, admin.id, new Date()]);
  await bulkInsert('parent_student_links', ['parent_id', 'student_id', 'relation', 'verified', 'verified_by', 'verified_at'], links);

  // ---------- campus geofence ----------
  await db.query(
    "INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m) VALUES (?, 'CAMPUS', 'CIRCLE', ?, ?, ?)",
    [CAMPUS.name, CAMPUS.lat, CAMPUS.lng, CAMPUS.radius_m],
  );

  // ---------- historical trips ----------
  const now = Date.now();
  const requests = [];
  const trips = [];
  const gateLogs = [];
  const events = [];
  const samples = [];
  const history = new Map(); // student id -> { n, late }
  const guards = [guard.id, guard2.id];
  const reviewers = [warden.id, warden2.id, warden3.id];

  // Generate departures spread over the last 12 months, then process chronologically.
  const plans = [];
  const NON_TRIPS = Math.round(TRIPS * 0.06); // extra rejected/cancelled requests on top of the completed trips
  for (let i = 0; i < TRIPS + NON_TRIPS; i++) {
    const s = pick(students);
    const category = weighted([['HOME_VISIT', 34], ['SHOPPING', 16], ['MEDICAL', 12], ['PERSONAL', 14], ['FAMILY_EVENT', 10], ['ACADEMIC', 9], ['OTHER', 5]]);
    // pick day: home visits/family events cluster on Fri/Sat departures
    let dayStart = now - int(3, 365) * DAY;
    const d = local(dayStart);
    if (['HOME_VISIT', 'FAMILY_EVENT'].includes(category) && rand() < 0.7) {
      const shift = (5 - d.getUTCDay() + 7) % 7; // move to Friday
      dayStart -= (7 - shift) % 7 === 0 ? 0 : (7 - shift) * DAY;
      if (dayStart > now - 3 * DAY) dayStart -= 7 * DAY;
    }
    plans.push({ s, category, dayStart, fate: 'TRIP' });
  }
  for (let k = 0; k < NON_TRIPS; k++) plans[k].fate = k % 3 === 2 ? 'CANCELLED' : 'REJECTED';
  plans.sort((a, b) => a.dayStart - b.dayStart);

  let reqId = 1;
  let tripId = 1;
  for (const p of plans) {
    const { s, category } = p;
    const localMidnight = (() => {
      const l = local(p.dayStart);
      l.setUTCHours(0, 0, 0, 0);
      return l.getTime() - 330 * MIN;
    })();
    const overnight = ['HOME_VISIT', 'FAMILY_EVENT'].includes(category) || (category === 'ACADEMIC' && rand() < 0.3);
    let dest;
    let destType;
    if (category === 'HOME_VISIT' || (category === 'FAMILY_EVENT' && rand() < 0.7)) {
      dest = s.home;
      destType = 'HOME';
    } else if (overnight) {
      const c = pick(HOME_CITIES);
      dest = { name: c[0], lat: c[1], lng: c[2] };
      destType = 'OTHER';
    } else {
      const c = pick(LOCAL_SPOTS);
      dest = { name: c[0], lat: c[1] + between(-0.002, 0.002), lng: c[2] + between(-0.002, 0.002) };
      destType = 'OTHER';
    }
    const departAt = localMidnight + (overnight ? between(14, 19) : between(8, 16)) * HOUR;
    let expectedReturn;
    if (overnight) {
      const nights = weighted([[1, 3], [2, 5], [3, 2], [4, 1]]);
      expectedReturn = localMidnight + nights * DAY + between(17, 21.5) * HOUR;
    } else {
      expectedReturn = departAt + between(2, 6) * HOUR;
    }
    const distKm = haversine(CAMPUS.lat, CAMPUS.lng, dest.lat, dest.lng) / 1000;
    const createdAt = departAt - (overnight ? between(6, 72) : between(0.5, 6)) * HOUR;
    const created = local(createdAt);
    // nudge request times toward evening/morning peaks
    const createdFinal = createdAt - ((created.getUTCHours() < 7 ? 6 : 0) * HOUR);
    const reviewMin = Math.min(600, Math.max(3, Math.exp(between(Math.log(8), Math.log(180)))));
    const reviewedAt = Math.min(departAt - 5 * MIN, createdFinal + reviewMin * MIN);

    const h = history.get(s.id) || { n: 0, late: 0 };
    const pastRate = (h.late + 0.75) / (h.n + 3);
    const ret = local(expectedReturn);
    const returnHour = ret.getUTCHours();
    const catEffect = { HOME_VISIT: 0.35, FAMILY_EVENT: 0.6, PERSONAL: 0.15, SHOPPING: -0.2, MEDICAL: 0.05, ACADEMIC: -0.6, OTHER: 0 }[category];
    const logit = -2.9 + 3.2 * s.propensity + 0.55 * Math.log1p(distKm) / Math.log1p(100) * 2 + (ret.getUTCDay() === 0 ? 0.7 : 0) +
      (returnHour >= 20 ? 0.6 : 0) + catEffect + between(-0.4, 0.4);
    const lateProb = 1 / (1 + Math.exp(-logit));

    // Rejected / cancelled requests never become trips.
    if (p.fate !== 'TRIP') {
      const status = p.fate;
      requests.push([reqId, s.id, pick(REASONS[category]), category, destType, dest.name, dest.lat, dest.lng, toSql(departAt), toSql(expectedReturn),
        status, status === 'REJECTED' ? pick(reviewers) : null, status === 'REJECTED' ? toSql(reviewedAt) : null,
        status === 'REJECTED' ? pick(['Exams this week', 'Insufficient reason', 'Parent consent not received', 'Too many outings this month']) : null,
        Math.round((100 * lateProb) / (lateProb + 0.3)), lateProb.toFixed(4), toSql(createdFinal)]);
      reqId++;
      continue;
    }

    const isLate = rand() < lateProb;
    const delay = isLate ? Math.round(16 + expo(18 + distKm * 0.12)) : Math.round(between(-150, 14));
    const actualReturn = expectedReturn + delay * MIN;
    const exitAt = departAt + between(-25, 45) * MIN;
    const travelMin = Math.max(10, (distKm / 38) * 60);
    const reachedAt = Math.min(exitAt + travelMin * MIN * between(0.9, 1.3), expectedReturn - 30 * MIN);
    const entryAt = actualReturn + between(0.5, 3) * MIN;
    const escalation = delay >= 60 ? 3 : delay >= 30 ? 2 : delay >= 15 ? 1 : 0;

    requests.push([reqId, s.id, pick(REASONS[category]), category, destType, dest.name, dest.lat, dest.lng, toSql(departAt), toSql(expectedReturn),
      'COMPLETED', pick(reviewers), toSql(reviewedAt), rand() < 0.3 ? pick(['Approved. Return on time.', 'OK', 'Carry ID card', 'Inform parents']) : null,
      Math.round((100 * lateProb) / (lateProb + 0.3)), lateProb.toFixed(4), toSql(createdFinal)]);
    trips.push([tripId, reqId, crypto.randomUUID(), 'COMPLETED', toSql(exitAt), pick(guards), toSql(entryAt), pick(guards), toSql(exitAt + 2 * MIN),
      reachedAt > exitAt ? toSql(reachedAt) : null, toSql(actualReturn), toSql(entryAt), escalation, toSql(actualReturn)]);
    gateLogs.push([tripId, pick(guards), 'EXIT', toSql(exitAt), 'OK', 'QR']);
    gateLogs.push([tripId, pick(guards), 'ENTRY', toSql(entryAt), delay > 0 ? 'OK_LATE' : 'OK', rand() < 0.04 ? 'MANUAL' : 'QR']);
    events.push([tripId, 'DEPARTED', toSql(exitAt)], [tripId, 'LEFT_CAMPUS', toSql(exitAt + 2 * MIN)]);
    if (reachedAt > exitAt) events.push([tripId, 'REACHED_DESTINATION', toSql(reachedAt)]);
    if (delay >= 15) events.push([tripId, 'OVERDUE', toSql(expectedReturn + 15 * MIN)]);
    events.push([tripId, 'RETURNED_CAMPUS', toSql(actualReturn)], [tripId, 'COMPLETED', toSql(entryAt)]);

    const lateFlag = delay > 15 ? 1 : 0;
    samples.push([tripId, s.id, category, destType, distKm, toSql(departAt), toSql(expectedReturn), toSql(actualReturn), toSql(createdFinal),
      toSql(reviewedAt), ret.getUTCDay(), returnHour, (expectedReturn - departAt) / HOUR, pastRate, Math.max(0, delay), lateFlag]);
    history.set(s.id, { n: h.n + 1, late: h.late + lateFlag });
    reqId++;
    tripId++;
  }

  await bulkInsert('outpass_requests', ['id', 'student_id', 'reason', 'reason_category', 'destination_type', 'dest_address', 'dest_lat', 'dest_lng',
    'depart_at', 'expected_return_at', 'status', 'reviewed_by', 'reviewed_at', 'remarks', 'risk_score', 'delay_probability', 'created_at'], requests);
  await bulkInsert('trips', ['id', 'request_id', 'qr_token_id', 'status', 'exit_at', 'exit_guard_id', 'entry_at', 'entry_guard_id', 'left_campus_at',
    'reached_destination_at', 'returned_at', 'completed_at', 'escalation_level', 'last_ping_at'], trips);
  await bulkInsert('gate_logs', ['trip_id', 'guard_id', 'type', 'scanned_at', 'result', 'method'], gateLogs);
  await bulkInsert('trip_events', ['trip_id', 'type', 'occurred_at'], events);
  await bulkInsert('ai_trip_samples', ['source_trip_id', 'student_id', 'reason_category', 'destination_type', 'distance_km', 'depart_at',
    'expected_return_at', 'actual_return_at', 'requested_at', 'approved_at', 'day_of_week', 'return_hour', 'duration_hours', 'past_delay_rate',
    'delay_minutes', 'is_late'], samples);
  console.log(`[seed] users=${users.length} requests=${requests.length} trips=${trips.length} samples=${samples.length}`);

  // ---------- train model ----------
  const { retrain } = require('../src/services/ai/trainer');
  const model = await retrain();
  console.log(`[seed] model ${model.version} trained: ${JSON.stringify(model.metrics)}`);

  // ---------- live demo state ----------
  const ai = require('../src/services/ai');
  const live = async ({ student, category, dest, destType, departOffsetMin, returnOffsetMin, status, reason }) => {
    const departAt = new Date(now + departOffsetMin * MIN);
    const expectedReturn = new Date(now + returnOffsetMin * MIN);
    const risk = await ai.predict({ student_id: student.id, reason_category: category, destination_type: destType, dest_lat: dest.lat, dest_lng: dest.lng,
      depart_at: departAt, expected_return_at: expectedReturn });
    const r = await db.query(
      `INSERT INTO outpass_requests (student_id, reason, reason_category, destination_type, dest_address, dest_lat, dest_lng, depart_at, expected_return_at,
         status, reviewed_by, reviewed_at, risk_score, delay_probability, predicted_delay_min, risk_reasons, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.id, reason || pick(REASONS[category]), category, destType, dest.name, dest.lat, dest.lng, departAt, expectedReturn, status,
        status === 'PENDING' ? null : warden.id, status === 'PENDING' ? null : new Date(now - 20 * MIN), risk.risk_score, risk.delay_probability,
        risk.expected_delay_min, JSON.stringify(risk.reasons), new Date(now - int(15, 120) * MIN)],
    );
    return { requestId: r.insertId, departAt, expectedReturn, risk };
  };
  const makeTrip = async (requestId, status, dest, studentName, extra = {}) => {
    const r = await db.query('INSERT INTO trips (request_id, qr_token_id, status, exit_at, exit_guard_id, left_campus_at, escalation_level) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      requestId, crypto.randomUUID(), status, extra.exitAt || null, extra.exitAt ? guard.id : null, extra.exitAt ? new Date(extra.exitAt.getTime() + 2 * MIN) : null,
      extra.escalation || 0,
    ]);
    await db.query("INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m, trip_id) VALUES (?, 'DESTINATION', 'CIRCLE', ?, ?, 200, ?)", [
      `Destination of ${studentName} (#${requestId})`, dest.lat, dest.lng, r.insertId,
    ]);
    if (extra.exitAt) {
      await db.query("INSERT INTO gate_logs (trip_id, guard_id, type, scanned_at, result, method) VALUES (?, ?, 'EXIT', ?, 'OK', 'QR')", [r.insertId, guard.id, extra.exitAt]);
      await db.query("INSERT INTO trip_events (trip_id, type, occurred_at) VALUES (?, 'DEPARTED', ?), (?, 'LEFT_CAMPUS', ?)", [
        r.insertId, extra.exitAt, r.insertId, new Date(extra.exitAt.getTime() + 2 * MIN),
      ]);
    }
    return r.insertId;
  };
  const addPings = async (tripIdV, from, to, count, startAt, stepMin) => {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const f = (i + 1) / count;
      rows.push([tripIdV, from.lat + (to.lat - from.lat) * f + between(-0.0005, 0.0005), from.lng + (to.lng - from.lng) * f + between(-0.0005, 0.0005),
        between(6, 25), between(8, 22), Number((0.9 - i * 0.01).toFixed(2)), new Date(startAt + i * stepMin * MIN)]);
    }
    await bulkInsert('location_pings', ['trip_id', 'lat', 'lng', 'accuracy', 'speed', 'battery', 'recorded_at'], rows);
    await db.query('UPDATE trips SET last_ping_at = ? WHERE id = ?', [rows[rows.length - 1][6], tripIdV]);
  };
  const consent = (tripIdV, studentId, at) =>
    db.query(
      "INSERT INTO tracking_consents (trip_id, student_id, scope, consent_text, granted_at) VALUES (?, ?, 'TRIP_LOCATION', ?, ?)",
      [tripIdV, studentId, 'I agree to share my live location with my warden and linked parents for this trip only. I can stop at any time; sharing ends automatically when the trip is completed.', at],
    );

  // Pending requests (students 3-6) with varied risk.
  const spots = LOCAL_SPOTS.map(([name, lat, lng]) => ({ name, lat, lng }));
  await live({ student: students[2], category: 'SHOPPING', dest: spots[1], destType: 'OTHER', departOffsetMin: 90, returnOffsetMin: 330, status: 'PENDING' });
  await live({ student: students[3], category: 'HOME_VISIT', dest: students[3].home, destType: 'HOME', departOffsetMin: 24 * 60, returnOffsetMin: 3 * 24 * 60 + 10 * 60, status: 'PENDING' });
  const habitual = students.filter((s) => s.propensity > 0.55)[0] || students[4];
  await live({ student: habitual, category: 'FAMILY_EVENT', dest: habitual.home, destType: 'HOME', departOffsetMin: 180, returnOffsetMin: 2 * 24 * 60 + 13 * 60, status: 'PENDING', reason: "Cousin's wedding" });
  await live({ student: students[5], category: 'MEDICAL', dest: spots[2], destType: 'OTHER', departOffsetMin: 45, returnOffsetMin: 225, status: 'PENDING', reason: 'Dental appointment' });

  // Approved pass waiting at the gate (student 10) — QR scan demo.
  const s10 = students[9];
  const a10 = await live({ student: s10, category: 'PERSONAL', dest: spots[4], destType: 'OTHER', departOffsetMin: -10, returnOffsetMin: 240, status: 'APPROVED', reason: 'Bank work' });
  await makeTrip(a10.requestId, 'APPROVED', spots[4], s10.name);

  // Active, tracked trips (students 7 & 8).
  for (const [s, spot] of [[students[6], spots[0]], [students[7], spots[5]]]) {
    const a = await live({ student: s, category: 'SHOPPING', dest: spot, destType: 'OTHER', departOffsetMin: -50, returnOffsetMin: 150, status: 'ACTIVE' });
    const t = await makeTrip(a.requestId, 'ACTIVE', spot, s.name, { exitAt: new Date(now - 45 * MIN) });
    await consent(t, s.id, new Date(now - 46 * MIN));
    await addPings(t, GATE, { lat: (GATE.lat + spot.lat) / 2, lng: (GATE.lng + spot.lng) / 2 }, 12, now - 44 * MIN, 1);
  }

  // Overdue trip (student 9): expected back 50 minutes ago, escalated to warden level.
  const s9 = students[8];
  const a9 = await live({ student: s9, category: 'PERSONAL', dest: spots[6], destType: 'OTHER', departOffsetMin: -5 * 60, returnOffsetMin: -50, status: 'OVERDUE', reason: 'Meeting a friend' });
  const t9 = await makeTrip(a9.requestId, 'OVERDUE', spots[6], s9.name, { exitAt: new Date(now - 5 * 60 * MIN + 5 * MIN), escalation: 2 });
  await consent(t9, s9.id, new Date(now - 5 * 60 * MIN));
  await addPings(t9, GATE, spots[6], 20, now - 4.5 * 60 * MIN, 12);
  await db.query("INSERT INTO trip_events (trip_id, type, occurred_at) VALUES (?, 'REACHED_DESTINATION', ?), (?, 'OVERDUE', ?)", [
    t9, new Date(now - 3 * 60 * MIN), t9, new Date(now - 35 * MIN),
  ]);
  await db.query('UPDATE trips SET reached_destination_at = ? WHERE id = ?', [new Date(now - 3 * 60 * MIN), t9]);

  await db.query("INSERT INTO audit_logs (actor_id, action, entity, details) VALUES (?, 'SEED', 'system', ?)", [admin.id, JSON.stringify({ trips: trips.length })]);

  console.log('\n[seed] done. Demo accounts (password for all: Password@123):');
  console.table([
    { role: 'admin', login: 'admin@smartoutpass.edu' },
    { role: 'warden', login: 'warden@smartoutpass.edu (Boys Hostel A)' },
    { role: 'faculty', login: 'faculty@smartoutpass.edu' },
    { role: 'security', login: 'security@smartoutpass.edu' },
    { role: 'student', login: 'student1@smartoutpass.edu or S2024001 (home: Erode)' },
    { role: 'parent', login: 'parent1@smartoutpass.edu (linked to S2024001 + S2024002)' },
  ]);
  console.log(`Live demo: 4 pending requests, approved pass for ${s10.roll_no}, 2 tracked trips, 1 overdue trip (${s9.roll_no}).`);
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await db.close();
    process.exit(1);
  });

#!/usr/bin/env node
/**
 * Replays a full student trip against a running API so you can watch notifications without leaving your desk.
 *
 *   exit scan -> moving away -> reached home -> (optionally overdue) -> back on campus -> entry scan
 *
 * Usage:
 *   npm run simulate                         # default: student1 (S2024001) to Mysuru, parent1 listening
 *   npm run simulate -- --scenario=overdue   # also time-travels past the return time and runs the overdue job
 *   npm run simulate -- --student=S2024002 --dest=12.9141,74.8560 --steps=15 --delay=500
 *
 * Options: --api=http://localhost:4000  --student=<roll|email>  --parent=<email>  --password=Password@123
 *          --dest=lat,lng  --steps=12 (pings per leg)  --delay=700 (ms between pings)  --scenario=full|overdue
 * Open the web app as warden / parent1 while it runs to see the live map and toasts update.
 */
const { io } = require('socket.io-client');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const API = arg('api', process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const PASSWORD = arg('password', 'Password@123');
const STUDENT = arg('student', 'S2024001');
const PARENT = arg('parent', 'parent1@smartoutpass.edu');
const WARDEN = arg('warden', 'warden@smartoutpass.edu');
const GUARD = arg('security', 'security@smartoutpass.edu');
const ADMIN = arg('admin', 'admin@smartoutpass.edu');
const STEPS = Number(arg('steps', 12));
const DELAY = Number(arg('delay', 700));
const SCENARIO = arg('scenario', 'full');
const [DEST_LAT, DEST_LNG] = arg('dest', '12.2958,76.6394').split(',').map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m', red: '\x1b[31m', bold: '\x1b[1m', reset: '\x1b[0m' };
const step = (msg) => console.log(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`);
const info = (msg) => console.log(`  ${msg}`);

async function api(method, path, token, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
    err.status = res.status;
    err.code = json.error?.code;
    throw err;
  }
  return json.data;
}

async function login(identifier) {
  const d = await api('POST', '/auth/login', null, { identifier, password: PASSWORD });
  return { token: d.accessToken, user: d.user };
}

function listen(label, color, token, subscribeTrip) {
  const received = [];
  const socket = io(API, { auth: { token }, transports: ['websocket'] });
  socket.on('connect_error', (e) => console.log(`  ${c.red}[${label}] socket error: ${e.message}${c.reset}`));
  socket.on('notification', (n) => {
    received.push(n);
    console.log(`  ${color}🔔 [${label}] ${n.type}: ${n.title}${c.reset} ${c.dim}— ${n.body}${c.reset}`);
  });
  socket.on('trip:event', (e) => label === 'warden' && console.log(`  ${c.dim}   [${label}] trip:event ${e.type}${c.reset}`));
  socket.on('tracking:stop', (e) => console.log(`  ${color}⏹  [${label}] tracking:stop (${e.reason})${c.reset}`));
  socket.subscribeTrip = (tripId) =>
    new Promise((resolve) => socket.emit('trip:subscribe', { tripId }, (ack) => resolve(ack)));
  socket.received = received;
  if (subscribeTrip) socket.emit('tracking:subscribe_all', {}, () => {});
  return socket;
}

/** Points from a to b (exclusive of a, inclusive of b) with small GPS jitter. */
function path(a, b, n) {
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 1) / n;
    const jitter = i === n - 1 ? 0 : 0.0004;
    return { lat: a.lat + (b.lat - a.lat) * f + (Math.random() - 0.5) * jitter, lng: a.lng + (b.lng - a.lng) * f + (Math.random() - 0.5) * jitter };
  });
}

async function ping(token, tripId, p, extra = {}) {
  const r = await api('POST', `/trips/${tripId}/location`, token, {
    lat: Number(p.lat.toFixed(6)),
    lng: Number(p.lng.toFixed(6)),
    accuracy: 12,
    speed: extra.speed ?? 15,
    battery: extra.battery ?? 0.8,
    timestamp: new Date().toISOString(),
  });
  const ev = r.events.length ? ` ${c.green}events: ${r.events.join(', ')}${c.reset}` : '';
  info(`${c.dim}ping ${p.lat.toFixed(4)},${p.lng.toFixed(4)} -> accepted=${r.accepted} next=${r.next_interval_sec}s${c.reset}${ev}`);
  return r;
}

async function main() {
  console.log(`${c.bold}SmartOutpass trip simulator${c.reset}  api=${API} student=${STUDENT} scenario=${SCENARIO}`);
  step('Logging in as student, warden, security and parent');
  const student = await login(STUDENT);
  const warden = await login(WARDEN);
  const guard = await login(GUARD);
  const parent = await login(PARENT);
  info(`student: ${student.user.name} (${student.user.roll_no}) · parent: ${parent.user.name} · warden: ${warden.user.name}`);

  const parentSocket = listen('parent', c.magenta, parent.token);
  const wardenSocket = listen('warden', c.yellow, warden.token, true);
  const studentSocket = listen('student', c.cyan, student.token);
  await sleep(500);

  const campus = await api('GET', '/geofences/campus', student.token);
  const inside = { lat: Number(campus.center_lat), lng: Number(campus.center_lng) };
  const gate = campus.polygon ? { lat: Math.min(...campus.polygon.map((p) => p[0])) + 0.0004, lng: inside.lng } : inside;
  const outside = { lat: gate.lat - 0.004, lng: gate.lng };
  const dest = { lat: DEST_LAT, lng: DEST_LNG };

  step('Clearing any open outpass for this student');
  const open = await api('GET', '/outpasses?status=PENDING,APPROVED,ACTIVE,OVERDUE', student.token);
  for (const o of open) {
    if (['PENDING', 'APPROVED'].includes(o.status) && !o.trip?.exit_at) {
      await api('POST', `/outpasses/${o.id}/cancel`, student.token);
      info(`cancelled outpass #${o.id} (${o.status})`);
    } else {
      throw new Error(`Student already has an ${o.status} trip (#${o.trip?.id}). Finish it (security ENTRY scan) or run \`npm run db:reset\`.`);
    }
  }

  step('Student requests an outpass (AI risk is computed on submit)');
  const departAt = new Date(Date.now() + 60_000);
  const returnAt = new Date(Date.now() + (SCENARIO === 'overdue' ? 10 : 240) * 60_000);
  const op = await api('POST', '/outpasses', student.token, {
    reason: 'Simulated weekend home visit',
    reason_category: 'HOME_VISIT',
    destination_type: 'HOME',
    dest_address: 'Simulated home address',
    dest_lat: dest.lat,
    dest_lng: dest.lng,
    depart_at: departAt.toISOString(),
    expected_return_at: returnAt.toISOString(),
  });
  info(`outpass #${op.id} ${op.status} · risk ${op.risk_score}/100 (${op.risk_level}) · ${op.risk_reasons.join('; ')}`);

  step('Warden approves');
  const approved = await api('POST', `/outpasses/${op.id}/approve`, warden.token, { remarks: 'Approved by simulator. Travel safe.' });
  const tripId = approved.trip.id;
  info(`trip #${tripId} created (status ${approved.trip.status})`);
  await sleep(300);

  step('Student consents to live location sharing for this trip');
  const consent = await api('POST', `/trips/${tripId}/consent`, student.token, { accept: true, scope: 'TRIP_LOCATION' });
  info(`consent #${consent.id} granted at ${consent.granted_at}`);
  try {
    await ping(student.token, tripId, inside);
  } catch (e) {
    info(`${c.green}✓ server refused tracking before gate exit: ${e.code}${c.reset}`);
  }

  step('Security scans the QR at the gate (EXIT)');
  const { token: qr } = await api('GET', `/trips/${tripId}/qr`, student.token);
  const verify = await api('POST', '/gate/verify', guard.token, { token: qr });
  info(`verify: action=${verify.action} student=${verify.student.name} return by ${verify.outpass.expected_return_at}`);
  const exit = await api('POST', '/gate/scan', guard.token, { token: qr });
  info(`${c.green}EXIT recorded (gate log #${exit.gate_log.id})${c.reset}`);
  const parentAck = await parentSocket.subscribeTrip(tripId);
  info(`parent subscribed to live trip room: ${JSON.stringify(parentAck)}`);
  await sleep(400);

  step(`Student travels to destination (${STEPS} pings)`);
  await ping(student.token, tripId, gate, { speed: 1 });
  for (const p of [outside, ...path(outside, dest, STEPS)]) {
    await ping(student.token, tripId, p);
    await sleep(DELAY);
  }
  step('Student stays at destination (debounce needs 2 consecutive accurate pings inside)');
  for (let i = 0; i < 2; i++) {
    await ping(student.token, tripId, { lat: dest.lat + 0.0003, lng: dest.lng - 0.0002 }, { speed: 0 });
    await sleep(DELAY);
  }

  if (SCENARIO === 'overdue') {
    step('Time travel: pretending the expected return was 65 minutes ago, then running the overdue job');
    const db = require('../src/db');
    await db.query('UPDATE outpass_requests SET depart_at = DATE_SUB(depart_at, INTERVAL 2 HOUR), expected_return_at = ? WHERE id = ?', [
      new Date(Date.now() - 65 * 60_000),
      op.id,
    ]);
    await db.query('UPDATE trips SET exit_at = DATE_SUB(exit_at, INTERVAL 2 HOUR) WHERE id = ?', [tripId]);
    await db.close();
    const admin = await login(ADMIN);
    const job = await api('POST', '/admin/jobs/overdue/run', admin.token);
    info(`overdue job: ${JSON.stringify(job.result)}`);
    await sleep(800);
    await api('POST', `/trips/${tripId}/notify`, warden.token, { target: 'parent' });
    info('warden used one-tap "notify parent"');
    await sleep(500);
  }

  step(`Student returns to campus (${STEPS} pings)`);
  for (const p of path(dest, outside, STEPS)) {
    await ping(student.token, tripId, p);
    await sleep(DELAY);
  }
  for (let i = 0; i < 2; i++) {
    await ping(student.token, tripId, { lat: inside.lat + i * 0.0002, lng: inside.lng }, { speed: 0.5 });
    await sleep(DELAY);
  }

  step('Security scans the same QR again (ENTRY) -> trip completes, tracking stops');
  const entry = await api('POST', '/gate/scan', guard.token, { token: qr });
  info(`${c.green}ENTRY recorded (${entry.gate_log.result}) -> trip ${entry.trip.status}${c.reset}`);
  await sleep(500);
  try {
    await api('POST', '/gate/scan', guard.token, { token: qr });
  } catch (e) {
    info(`${c.green}✓ third scan rejected: ${e.code}${c.reset}`);
  }
  try {
    await ping(student.token, tripId, inside);
  } catch (e) {
    info(`${c.green}✓ tracking refused after completion: ${e.code}${c.reset}`);
  }

  await sleep(800);
  step('Summary');
  const types = (s) => s.received.map((n) => n.type).join(', ') || '(none)';
  info(`parent received : ${types(parentSocket)}`);
  info(`warden received : ${types(wardenSocket)}`);
  info(`student received: ${types(studentSocket)}`);
  const trip = await api('GET', `/trips/${tripId}`, warden.token);
  info(`timeline: ${trip.events.map((e) => e.type).join(' → ')}`);
  [parentSocket, wardenSocket, studentSocket].forEach((s) => s.close());
}

main().catch((err) => {
  console.error(`\n${c.red}Simulation failed: ${err.message}${c.reset}`);
  if (err.cause) console.error(err.cause);
  process.exit(1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { haversine, pointInPolygon, isInsideFence, distanceToFence } = require('../src/utils/geo');
const { evaluatePing, nextIntervalSec } = require('../src/services/geofence.engine');

const campus = {
  shape: 'POLYGON',
  center_lat: 12.9716,
  center_lng: 77.5946,
  polygon: [
    [12.9746, 77.5911],
    [12.9748, 77.5979],
    [12.9689, 77.5984],
    [12.9684, 77.5915],
  ],
};
const home = { shape: 'CIRCLE', center_lat: 12.2958, center_lng: 76.6394, radius_m: 200 };
const ctx = { campus, destination: home, debounce: 2, maxAccuracy: 100 };
const empty = { left_campus_at: null, reached_destination_at: null, returned_at: null, dest_streak: 0, campus_streak: 0 };
const at = (min) => new Date(Date.UTC(2026, 9, 20, 8, min));

test('haversine: Bengaluru -> Mysuru ≈ 128 km, zero for same point', () => {
  const d = haversine(12.9716, 77.5946, 12.2958, 76.6394);
  assert.ok(d > 125_000 && d < 131_000, `got ${d}`);
  assert.equal(haversine(1, 1, 1, 1), 0);
});

test('point in polygon / circle', () => {
  assert.equal(pointInPolygon(12.9716, 77.5946, campus.polygon), true);
  assert.equal(pointInPolygon(12.9800, 77.5946, campus.polygon), false);
  assert.equal(isInsideFence(12.2960, 76.6395, home), true);
  assert.equal(isInsideFence(12.3100, 76.6394, home), false); // ~1.6 km north
});

test('distanceToFence: 0 inside, roughly correct outside', () => {
  assert.equal(distanceToFence(12.9716, 77.5946, campus), 0);
  const d = distanceToFence(12.9766, 77.5946, campus); // ~200 m north of the north edge
  assert.ok(d > 150 && d < 260, `got ${d}`);
  const dc = distanceToFence(12.2958 + 0.0045, 76.6394, home); // ~500 m from centre => ~300 m outside
  assert.ok(dc > 280 && dc < 320, `got ${dc}`);
});

test('LEFT_CAMPUS fires on first accurate ping outside campus', () => {
  const r = evaluatePing(empty, { lat: 12.96, lng: 77.58, accuracy: 15, recorded_at: at(1) }, ctx);
  assert.deepEqual(r.events.map((e) => e.type), ['LEFT_CAMPUS']);
  assert.ok(r.state.left_campus_at);
});

test('destination needs 2 consecutive pings inside (debounce) and fires once', () => {
  let s = { ...empty, left_campus_at: at(0) };
  const inside = (m) => ({ lat: 12.2959, lng: 76.6395, accuracy: 20, recorded_at: at(m) });
  const outside = (m) => ({ lat: 12.33, lng: 76.65, accuracy: 20, recorded_at: at(m) });

  let r = evaluatePing(s, inside(1), ctx);
  assert.equal(r.events.length, 0, 'single ping inside must not trigger');
  r = evaluatePing(r.state, outside(2), ctx);
  assert.equal(r.state.dest_streak, 0, 'streak resets when leaving');
  r = evaluatePing(r.state, inside(3), ctx);
  r = evaluatePing(r.state, inside(4), ctx);
  assert.deepEqual(r.events.map((e) => e.type), ['REACHED_DESTINATION']);
  assert.equal(r.state.reached_destination_at.getTime(), at(4).getTime());
  s = r.state;
  r = evaluatePing(s, inside(5), ctx);
  r = evaluatePing(r.state, inside(6), ctx);
  assert.equal(r.events.length, 0, 'event is never repeated');
});

test('inaccurate pings (>= 100 m) are ignored and do not count toward debounce', () => {
  let r = evaluatePing({ ...empty, left_campus_at: at(0) }, { lat: 12.2959, lng: 76.6395, accuracy: 20, recorded_at: at(1) }, ctx);
  r = evaluatePing(r.state, { lat: 12.2959, lng: 76.6395, accuracy: 150, recorded_at: at(2) }, ctx);
  assert.equal(r.ignored, true);
  assert.equal(r.events.length, 0);
  assert.equal(r.state.dest_streak, 1);
});

test('RETURNED_CAMPUS only after having left campus, with debounce', () => {
  const inCampus = (m) => ({ lat: 12.9716, lng: 77.5946, accuracy: 10, recorded_at: at(m) });
  // Still inside right after the gate: never "returns" without leaving.
  let r = evaluatePing(empty, inCampus(1), ctx);
  r = evaluatePing(r.state, inCampus(2), ctx);
  assert.equal(r.events.length, 0);
  // Leave, then come back.
  r = evaluatePing(r.state, { lat: 12.95, lng: 77.58, accuracy: 10, recorded_at: at(3) }, ctx);
  assert.deepEqual(r.events.map((e) => e.type), ['LEFT_CAMPUS']);
  r = evaluatePing(r.state, inCampus(10), ctx);
  assert.equal(r.events.length, 0);
  r = evaluatePing(r.state, inCampus(11), ctx);
  assert.deepEqual(r.events.map((e) => e.type), ['RETURNED_CAMPUS']);
});

test('several campus fences (college + off-site hostel): outside all = left, inside any = returned', () => {
  const college = { shape: 'CIRCLE', center_lat: 11.481, center_lng: 77.875, radius_m: 300 };
  const hostel = { shape: 'CIRCLE', center_lat: 11.4571, center_lng: 77.7905, radius_m: 300 };
  const multi = { campus: [college, hostel], destination: null, debounce: 2, maxAccuracy: 100 };
  const p = (lat, lng, m) => ({ lat, lng, accuracy: 15, recorded_at: at(m) });
  // Starting at the hostel is not "leaving"; moving between nothing and the college is.
  let r = evaluatePing(empty, p(11.4571, 77.7905, 1), multi);
  assert.equal(r.events.length, 0);
  r = evaluatePing(r.state, p(11.40, 77.70, 2), multi);
  assert.deepEqual(r.events.map((e) => e.type), ['LEFT_CAMPUS']);
  // Coming back to the hostel (not the college) counts as returned.
  r = evaluatePing(r.state, p(11.4572, 77.7906, 3), multi);
  r = evaluatePing(r.state, p(11.4571, 77.7905, 4), multi);
  assert.deepEqual(r.events.map((e) => e.type), ['RETURNED_CAMPUS']);
  // A single fence object is still accepted.
  const single = evaluatePing(empty, p(11.40, 77.70, 1), { ...multi, campus: college });
  assert.deepEqual(single.events.map((e) => e.type), ['LEFT_CAMPUS']);
});

test('battery/motion-aware interval', () => {
  const s = { tracking_interval_moving_sec: 30, tracking_interval_idle_sec: 60, tracking_interval_low_battery_sec: 120 };
  assert.equal(nextIntervalSec({ speed: 10, battery: 0.8 }, s), 30);
  assert.equal(nextIntervalSec({ speed: 0.2, battery: 0.8 }, s), 60);
  assert.equal(nextIntervalSec({ speed: 10, battery: 0.1 }, s), 120);
});

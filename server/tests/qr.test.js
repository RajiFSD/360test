const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signQrToken, verifyQrSignature, evaluateScan } = require('../src/utils/qr');
const { trackingDecision } = require('../src/services/tracking.service');

const SECRET = 'test-qr-secret';
const now = new Date('2026-10-20T10:00:00Z');
const request = { depart_at: '2026-10-20T10:30:00Z', expected_return_at: '2026-10-20T16:00:00Z' };
const jti = '7b0e8c55-3a52-4c8e-9a7e-1f2a3b4c5d6e';
const approvedTrip = { status: 'APPROVED', qr_token_id: jti, exit_at: null, entry_at: null };

const tokenFor = (opts = {}) =>
  signQrToken({ tripId: 42, jti, expiresAt: opts.expiresAt || '2026-10-21T04:00:00Z', ...opts }, opts.secret || SECRET);

test('valid token verifies and carries trip id + jti', () => {
  const r = verifyQrSignature(tokenFor(), SECRET, now);
  assert.equal(r.ok, true);
  assert.equal(r.payload.tid, 42);
  assert.equal(r.payload.jti, jti);
});

test('tampered or foreign-signed token is rejected as QR_INVALID', () => {
  const forged = tokenFor({ secret: 'attacker-secret' });
  assert.deepEqual(verifyQrSignature(forged, SECRET, now), { ok: false, code: 'QR_INVALID' });
  const t = tokenFor();
  const [h, , s] = t.split('.');
  const body = Buffer.from(JSON.stringify({ typ: 'outpass', tid: 99, jti, exp: 1893456000 })).toString('base64url');
  assert.equal(verifyQrSignature(`${h}.${body}.${s}`, SECRET, now).code, 'QR_INVALID');
  assert.equal(verifyQrSignature('not-a-jwt', SECRET, now).code, 'QR_INVALID');
  assert.equal(verifyQrSignature(null, SECRET, now).code, 'QR_INVALID');
});

test('alg=none and non-outpass tokens are rejected', () => {
  const none = jwt.sign({ typ: 'outpass', tid: 42, jti }, null, { algorithm: 'none' });
  assert.equal(verifyQrSignature(none, SECRET, now).code, 'QR_INVALID');
  const other = jwt.sign({ typ: 'access', tid: 42 }, SECRET, { jwtid: jti, expiresIn: '1h' });
  assert.equal(verifyQrSignature(other, SECRET, now).code, 'QR_INVALID');
});

test('expired token -> QR_EXPIRED', () => {
  const t = tokenFor({ expiresAt: '2026-10-20T09:00:00Z' });
  assert.equal(verifyQrSignature(t, SECRET, now).code, 'QR_EXPIRED');
});

test('first scan within window is EXIT; too early is OUTSIDE_TIME_WINDOW', () => {
  const { payload } = verifyQrSignature(tokenFor(), SECRET, now);
  assert.deepEqual(evaluateScan({ payload, trip: approvedTrip, request, now, exitEarlyMin: 60 }), { ok: true, action: 'EXIT' });
  const early = new Date('2026-10-20T09:00:00Z');
  assert.equal(evaluateScan({ payload, trip: approvedTrip, request, now: early, exitEarlyMin: 60 }).code, 'OUTSIDE_TIME_WINDOW');
  const late = new Date('2026-10-20T16:30:00Z');
  assert.equal(evaluateScan({ payload, trip: approvedTrip, request, now: late, exitEarlyMin: 60 }).code, 'OUTSIDE_TIME_WINDOW');
});

test('after exit the same QR is ENTRY (also when overdue); after entry it is reused', () => {
  const { payload } = verifyQrSignature(tokenFor(), SECRET, now);
  const active = { ...approvedTrip, status: 'ACTIVE', exit_at: now };
  assert.deepEqual(evaluateScan({ payload, trip: active, request, now }), { ok: true, action: 'ENTRY' });
  assert.deepEqual(evaluateScan({ payload, trip: { ...active, status: 'OVERDUE' }, request, now }), { ok: true, action: 'ENTRY' });
  const done = { ...active, status: 'COMPLETED', entry_at: now };
  assert.equal(evaluateScan({ payload, trip: done, request, now }).code, 'QR_ALREADY_USED');
});

test('replaced jti -> QR_REVOKED; cancelled/pending trip -> PASS_NOT_APPROVED', () => {
  const { payload } = verifyQrSignature(tokenFor(), SECRET, now);
  assert.equal(evaluateScan({ payload, trip: { ...approvedTrip, qr_token_id: 'other' }, request, now }).code, 'QR_REVOKED');
  assert.equal(evaluateScan({ payload, trip: { ...approvedTrip, status: 'CANCELLED' }, request, now }).code, 'PASS_NOT_APPROVED');
});

test('tracking is only allowed when ACTIVE/OVERDUE, consented and inside the trip window', () => {
  const trip = { status: 'ACTIVE', exit_at: '2026-10-20T10:35:00Z', expected_return_at: '2026-10-20T16:00:00Z' };
  const consent = { revoked_at: null };
  const t = new Date('2026-10-20T12:00:00Z');
  assert.deepEqual(trackingDecision({ trip, consent, now: t, overrunMin: 720 }), { ok: true });
  assert.equal(trackingDecision({ trip: { ...trip, status: 'APPROVED' }, consent, now: t, overrunMin: 720 }).reason, 'TRIP_NOT_ACTIVE');
  assert.equal(trackingDecision({ trip: { ...trip, status: 'COMPLETED' }, consent, now: t, overrunMin: 720 }).reason, 'TRIP_NOT_ACTIVE');
  assert.equal(trackingDecision({ trip, consent: null, now: t, overrunMin: 720 }).reason, 'NO_CONSENT');
  assert.equal(trackingDecision({ trip, consent: { revoked_at: t }, now: t, overrunMin: 720 }).reason, 'NO_CONSENT');
  assert.equal(trackingDecision({ trip, consent, now: new Date('2026-10-21T05:00:00Z'), overrunMin: 720 }).reason, 'OUTSIDE_TRIP_WINDOW');
});

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * QR tokens are short JWTs signed with a dedicated secret (HS256).
 * Payload: { typ: 'outpass', tid: tripId, jti, exp }.
 * exp = expected return + overrun window, so a pass can never be used after its trip window.
 */
function signQrToken({ tripId, jti, expiresAt }, secret) {
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  return jwt.sign({ typ: 'outpass', tid: tripId, exp }, secret, { algorithm: 'HS256', jwtid: jti, noTimestamp: false });
}

const QR_ERRORS = {
  QR_INVALID: 'This QR code is not a valid SmartOutpass pass.',
  QR_EXPIRED: 'This pass has expired.',
  QR_REVOKED: 'This QR code has been replaced or revoked. Ask the student to refresh their pass.',
  QR_ALREADY_USED: 'This pass has already been used for both exit and entry.',
  PASS_NOT_APPROVED: 'This outpass is not approved.',
  OUTSIDE_TIME_WINDOW: 'This pass is not valid at this time.',
  TRIP_CLOSED: 'This trip is already closed.',
  PASS_PAUSED: 'This daily pass is paused. The student cannot leave on it until it is resumed.',
  PASS_REVOKED: 'This daily pass has been cancelled or revoked.',
  PASS_EXPIRED: 'This daily pass has ended.',
  NOT_SCHEDULED_TODAY: "This QR is not for today. A daily pass needs that day's QR; ask the student to refresh the pass.",
};

/** Verify signature + expiry. Returns { ok, payload } or { ok:false, code }. Pure: no DB. */
function verifyQrSignature(token, secret, now = new Date()) {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, code: 'QR_INVALID' };
  let payload;
  try {
    // Signature first (expiry checked below), so forged tokens are never reported as merely "expired".
    payload = jwt.verify(token.trim(), secret, { algorithms: ['HS256'], ignoreExpiration: true });
  } catch {
    return { ok: false, code: 'QR_INVALID' };
  }
  if (payload.typ !== 'outpass' || !Number.isInteger(payload.tid) || !payload.jti || !Number.isInteger(payload.exp)) {
    return { ok: false, code: 'QR_INVALID' };
  }
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, code: 'QR_EXPIRED', payload };
  return { ok: true, payload };
}

/**
 * Decide what a scan of this trip means right now. Pure: works on plain objects.
 * trip: { status, qr_token_id, exit_at, entry_at }, request: { depart_at, expected_return_at }
 * Returns { ok:true, action:'EXIT'|'ENTRY' } or { ok:false, code }.
 */
function evaluateScan({ payload, trip, request, now = new Date(), exitEarlyMin = 60 }) {
  if (!trip || !request) return { ok: false, code: 'QR_INVALID' };
  if (payload.jti !== trip.qr_token_id) return { ok: false, code: 'QR_REVOKED' };
  if (trip.status === 'CANCELLED') return { ok: false, code: 'PASS_NOT_APPROVED' };
  if (trip.status === 'COMPLETED') return { ok: false, code: trip.entry_at ? 'QR_ALREADY_USED' : 'TRIP_CLOSED' };

  if (!trip.exit_at) {
    if (trip.status !== 'APPROVED') return { ok: false, code: 'PASS_NOT_APPROVED' };
    const earliest = new Date(request.depart_at).getTime() - exitEarlyMin * 60_000;
    const latest = new Date(request.expected_return_at).getTime();
    if (now.getTime() < earliest || now.getTime() > latest) return { ok: false, code: 'OUTSIDE_TIME_WINDOW' };
    return { ok: true, action: 'EXIT' };
  }
  if (!trip.entry_at && (trip.status === 'ACTIVE' || trip.status === 'OVERDUE')) return { ok: true, action: 'ENTRY' };
  return { ok: false, code: 'QR_ALREADY_USED' };
}

const newJti = () => crypto.randomUUID();

module.exports = { signQrToken, verifyQrSignature, evaluateScan, newJti, QR_ERRORS };

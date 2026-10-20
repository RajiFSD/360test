const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const repo = require('../services/repo');
const settings = require('../services/settings.service');
const tripSvc = require('../services/trip.service');
const tracking = require('../services/tracking.service');
const { notify } = require('../services/notification.service');
const { emitTo, rooms } = require('../realtime');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, forbidden, conflict, unprocessable } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok, pagination, csvList, iso } = require('../utils/http');
const { signQrToken } = require('../utils/qr');
const { isInsideFence, distanceToFence } = require('../utils/geo');

const router = express.Router();
router.use(authenticate());

const CONSENT_TEXT =
  'I agree to share my live location with my warden and linked parents for this trip only. I can stop at any time; sharing ends automatically when the trip is completed.';

/** Loads a trip and enforces who may see it. Returns { trip, raw }. */
async function loadTripFor(user, id) {
  const raw = await repo.getTripRaw(id);
  if (!raw) throw notFound('Trip');
  if (user.role === 'student' && raw.student_id !== user.id) throw forbidden();
  if (user.role === 'parent' && !(await repo.linkedStudentIds(user.id)).includes(raw.student_id)) throw forbidden();
  const trip = await repo.getTrip(id);
  // Parents only see location while the student is actively sharing for this trip.
  if (user.role === 'parent' && !trip.tracking_active) trip.last_location = null;
  return { trip, raw };
}

async function scopeFor(user) {
  if (user.role === 'student') return { where: 'o.student_id = ?', params: [user.id] };
  if (user.role === 'parent') {
    const ids = await repo.linkedStudentIds(user.id);
    return ids.length ? { where: 'o.student_id IN (?)', params: [ids] } : { where: '1=0', params: [] };
  }
  return { where: '1=1', params: [] };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = pagination(req.query);
    const scope = await scopeFor(req.user);
    const where = [scope.where];
    const params = [...scope.params];
    const statuses = csvList(req.query.status, ['APPROVED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED']);
    if (statuses.length) {
      where.push('t.status IN (?)');
      params.push(statuses);
    }
    if (req.query.student_id) {
      where.push('o.student_id = ?');
      params.push(Number(req.query.student_id));
    }
    const { items, total } = await repo.listTrips(where.join(' AND '), params, { limit, offset });
    if (req.user.role === 'parent') items.forEach((t) => !t.tracking_active && (t.last_location = null));
    ok(res, items, { page, pageSize, total });
  }),
);

router.get(
  '/live',
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const { items } = await repo.listTrips(
      "t.status IN ('ACTIVE','OVERDUE') AND EXISTS(SELECT 1 FROM tracking_consents c WHERE c.trip_id = t.id AND c.revoked_at IS NULL)",
      [],
      { limit: 500 },
    );
    ok(res, items);
  }),
);

router.get(
  '/overdue',
  requireRole('warden', 'faculty', 'admin'),
  asyncHandler(async (req, res) => {
    const { items } = await repo.listTrips("t.status = 'OVERDUE'", [], { limit: 500, order: 'o.expected_return_at ASC' });
    const now = Date.now();
    for (const t of items) {
      t.minutes_late = Math.max(0, Math.floor((now - new Date(t.expected_return_at)) / 60000));
      t.parents = (await repo.parentsOf(t.student_id)).map((p) => ({ id: p.id, name: p.name, phone: p.phone }));
      if (!t.tracking_active) t.last_location = null;
    }
    ok(res, items);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { trip } = await loadTripFor(req.user, id);
    const consent = await repo.getActiveConsent(id);
    ok(res, {
      ...trip,
      consent: repo.serializeConsent(consent),
      gate_logs: await repo.getGateLogs(id),
      events: await repo.getTripEvents(id),
    });
  }),
);

router.get(
  '/:id/qr',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { raw } = await loadTripFor(req.user, Number(req.params.id));
    if (!['APPROVED', 'ACTIVE', 'OVERDUE'].includes(raw.status)) throw conflict(`Trip is ${raw.status}; no QR available`);
    const overrun = await settings.get('tracking_overrun_max_min');
    const expiresAt = new Date(new Date(raw.expected_return_at).getTime() + overrun * 60_000);
    if (expiresAt <= new Date()) throw conflict('This pass has expired');
    const token = signQrToken({ tripId: raw.id, jti: raw.qr_token_id, expiresAt }, config.qrSecret);
    ok(res, { token, expires_at: iso(expiresAt), next_action: raw.exit_at ? 'ENTRY' : 'EXIT' });
  }),
);

router.get(
  '/:id/locations',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { trip } = await loadTripFor(req.user, id);
    if (req.user.role === 'security') throw forbidden();
    if (req.user.role === 'parent' && !trip.tracking_active) throw forbidden('Live location is not shared for this trip');
    const params = [id];
    let since = '';
    if (req.query.since) {
      since = ' AND recorded_at > ?';
      params.push(new Date(req.query.since));
    }
    // Parents only see pings from the current consent window.
    if (req.user.role === 'parent') {
      const c = await repo.getActiveConsent(id);
      since += ' AND recorded_at >= ?';
      params.push(c.granted_at);
    }
    const limit = Math.min(2000, Number(req.query.limit) || 500);
    const rows = await db.query(
      `SELECT * FROM (SELECT lat, lng, accuracy, speed, battery, recorded_at FROM location_pings WHERE trip_id = ?${since}
       ORDER BY recorded_at DESC LIMIT ?) x ORDER BY recorded_at ASC`,
      [...params, limit],
    );
    ok(res, rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng), recorded_at: iso(r.recorded_at) })));
  }),
);

const pingSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100000).optional().nullable(),
  speed: z.coerce.number().min(-1).max(500).optional().nullable(),
  battery: z.coerce.number().min(-1).max(1).optional().nullable(),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
});

const pingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: (req) => `ping:${req.user?.id}`,
  handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many location updates' } }),
});

router.post(
  '/:id/location',
  requireRole('student'),
  pingLimiter,
  validate(z.union([z.object({ pings: z.array(pingSchema).min(1).max(50) }), pingSchema])),
  asyncHandler(async (req, res) => {
    const pings = req.body.pings ? req.body.pings : [req.body];
    const normalized = pings.map((p) => ({ ...p, speed: p.speed != null && p.speed < 0 ? null : p.speed, battery: p.battery != null && p.battery < 0 ? null : p.battery }));
    ok(res, await tracking.ingestPings(req.user, Number(req.params.id), normalized));
  }),
);

router.get(
  '/:id/consent',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user.role === 'parent' || req.user.role === 'security') throw forbidden();
    await loadTripFor(req.user, id);
    const history = await db.query('SELECT * FROM tracking_consents WHERE trip_id = ? ORDER BY id DESC', [id]);
    const current = history.find((c) => !c.revoked_at) || null;
    ok(res, { current: repo.serializeConsent(current), history: history.map(repo.serializeConsent), consent_text: CONSENT_TEXT });
  }),
);

router.post(
  '/:id/consent',
  requireRole('student'),
  validate(z.object({ accept: z.literal(true), scope: z.literal('TRIP_LOCATION').optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { raw } = await loadTripFor(req.user, id);
    if (!['APPROVED', 'ACTIVE', 'OVERDUE'].includes(raw.status)) throw conflict(`Cannot share location for a ${raw.status} trip`);
    const existing = await repo.getActiveConsent(id);
    if (existing) return ok(res, repo.serializeConsent(existing));
    const now = new Date();
    const r = await db.query(
      `INSERT INTO tracking_consents (trip_id, student_id, scope, consent_text, granted_at, ip, user_agent) VALUES (?, ?, 'TRIP_LOCATION', ?, ?, ?, ?)`,
      [id, req.user.id, CONSENT_TEXT, now, req.ip, String(req.headers['user-agent'] || '').slice(0, 255)],
    );
    await db.query('UPDATE trips SET signal_lost_at = NULL WHERE id = ?', [id]);
    await audit(req, 'CONSENT_GRANTED', 'trip', id, { consentId: r.insertId, scope: 'TRIP_LOCATION' });
    tripSvc.broadcastEvent(raw, 'CONSENT_GRANTED', now);
    emitTo(rooms.staff, 'dashboard:refresh', { reason: 'consent' });
    const c = await db.one('SELECT * FROM tracking_consents WHERE id = ?', [r.insertId]);
    ok(res, repo.serializeConsent(c), undefined, 201);
  }),
);

router.delete(
  '/:id/consent',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { raw } = await loadTripFor(req.user, id);
    const existing = await repo.getActiveConsent(id);
    if (!existing) throw conflict('Location sharing is not active for this trip');
    await tripSvc.stopTracking(id, raw.student_id, 'CONSENT_REVOKED');
    await audit(req, 'CONSENT_REVOKED', 'trip', id, { consentId: existing.id });
    tripSvc.broadcastEvent(raw, 'CONSENT_REVOKED', new Date());
    ok(res, repo.serializeConsent(await db.one('SELECT * FROM tracking_consents WHERE id = ?', [existing.id])));
  }),
);

router.post(
  '/:id/checkin',
  requireRole('student'),
  validate(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { raw } = await loadTripFor(req.user, id);
    if (!['ACTIVE', 'OVERDUE'].includes(raw.status)) throw conflict('Check-in is only possible during an active trip');
    const campuses = await repo.getCampusFences();
    if (!campuses.length) throw conflict('Campus geofence is not configured');
    const { lat, lng } = req.body;
    const tolerance = Math.min(Number(req.body.accuracy) || 0, await settings.get('geofence_max_accuracy_m'));
    // Any campus fence counts (college or hostel); report the distance to the nearest one.
    const distance = Math.round(Math.min(...campuses.map((f) => distanceToFence(lat, lng, f))));
    if (!campuses.some((f) => isInsideFence(lat, lng, f)) && distance > tolerance) {
      throw unprocessable('OUTSIDE_CAMPUS', `You are about ${distance} m outside the campus boundary.`, { distance_m: distance });
    }
    await tripSvc.markReturned(id, new Date(), 'CHECKIN');
    await audit(req, 'TRIP_CHECKIN', 'trip', id, { lat, lng, accuracy: req.body.accuracy });
    ok(res, (await loadTripFor(req.user, id)).trip);
  }),
);

router.post(
  '/:id/notify',
  requireRole('warden', 'faculty', 'admin'),
  validate(z.object({ target: z.enum(['student', 'parent', 'both']), message: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const raw = await repo.getTripRaw(id);
    if (!raw) throw notFound('Trip');
    const { target, message } = req.body;
    const minutesLate = Math.max(0, Math.floor((Date.now() - new Date(raw.expected_return_at)) / 60000));
    let sent = 0;
    if (target === 'student' || target === 'both') {
      sent += await notify({
        userIds: [raw.student_id],
        type: raw.status === 'OVERDUE' ? 'OVERDUE' : 'MANUAL_NOTICE',
        title: raw.status === 'OVERDUE' ? 'Return to campus now' : 'Message from your warden',
        body: message || (raw.status === 'OVERDUE' ? `You are ${minutesLate} min overdue. Please return or call your warden immediately.` : 'Please contact your warden.'),
        tripId: id,
      });
    }
    if (target === 'parent' || target === 'both') {
      // Parents may only receive authorised events; a manual nudge is allowed for overdue trips.
      if (raw.status !== 'OVERDUE') throw conflict('Parents can only be notified about overdue trips');
      sent += await notify({
        userIds: await tripSvc.parentIds(raw.student_id),
        type: 'OVERDUE',
        title: `${raw.student_name} is overdue`,
        body: message || `${raw.student_name} is ${minutesLate} min past the expected return time. Please contact your ward.`,
        tripId: id,
        sms: true,
      });
    }
    await audit(req, 'TRIP_NOTIFY', 'trip', id, { target, sent });
    ok(res, { sent });
  }),
);

module.exports = router;
module.exports.CONSENT_TEXT = CONSENT_TEXT;

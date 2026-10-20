const express = require('express');
const { z } = require('zod');
const db = require('../db');
const repo = require('../services/repo');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, notFound, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();
router.use(authenticate());

const point = z.tuple([z.coerce.number().min(-90).max(90), z.coerce.number().min(-180).max(180)]);
const base = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(['CAMPUS', 'DESTINATION', 'CUSTOM']),
  shape: z.enum(['CIRCLE', 'POLYGON']),
  center_lat: z.coerce.number().min(-90).max(90),
  center_lng: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(10).max(50000).optional().nullable(),
  polygon: z.array(point).min(3).max(200).optional().nullable(),
  is_active: z.boolean().optional(),
});
const shapeOk = (v) => (v.shape === 'CIRCLE' ? !!v.radius_m : Array.isArray(v.polygon) && v.polygon.length >= 3);
const createSchema = base.refine(shapeOk, { message: 'CIRCLE needs radius_m; POLYGON needs at least 3 points', path: ['shape'] });

router.get(
  '/campus',
  asyncHandler(async (req, res) => {
    const fence = await repo.getCampusFence();
    if (!fence) throw notFound('Campus geofence');
    ok(res, fence);
  }),
);

router.get(
  '/campuses',
  asyncHandler(async (req, res) => ok(res, await repo.getCampusFences())),
);

router.get(
  '/',
  requireRole('admin', 'warden', 'faculty'),
  asyncHandler(async (req, res) => {
    const type = ['CAMPUS', 'DESTINATION', 'CUSTOM'].includes(req.query.type) ? req.query.type : null;
    // Destination fences are per trip and numerous; only list them when asked.
    const rows = await db.query(
      `SELECT * FROM geofences WHERE ${type ? 'type = ?' : "type <> 'DESTINATION'"} ORDER BY type, name LIMIT 500`,
      type ? [type] : [],
    );
    ok(res, rows.map(repo.serializeFence));
  }),
);

router.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await db.query(
      'INSERT INTO geofences (name, type, shape, center_lat, center_lng, radius_m, polygon, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [b.name, b.type, b.shape, b.center_lat, b.center_lng, b.radius_m ?? null, b.polygon ? JSON.stringify(b.polygon) : null, b.is_active === false ? 0 : 1],
    );
    await audit(req, 'GEOFENCE_CREATED', 'geofence', r.insertId, { name: b.name, type: b.type });
    ok(res, repo.serializeFence(await db.one('SELECT * FROM geofences WHERE id = ?', [r.insertId])), undefined, 201);
  }),
);

router.put(
  '/:id',
  requireRole('admin'),
  validate(base.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const current = await db.one('SELECT * FROM geofences WHERE id = ?', [id]);
    if (!current) throw notFound('Geofence');
    const merged = { ...repo.serializeFence(current), ...req.body };
    if (!shapeOk(merged)) throw badRequest('CIRCLE needs radius_m; POLYGON needs at least 3 points');
    await db.query(
      'UPDATE geofences SET name = ?, type = ?, shape = ?, center_lat = ?, center_lng = ?, radius_m = ?, polygon = ?, is_active = ? WHERE id = ?',
      [
        merged.name, merged.type, merged.shape, merged.center_lat, merged.center_lng, merged.radius_m ?? null,
        merged.polygon ? JSON.stringify(merged.polygon) : null, merged.is_active ? 1 : 0, id,
      ],
    );
    await audit(req, 'GEOFENCE_UPDATED', 'geofence', id, req.body);
    ok(res, repo.serializeFence(await db.one('SELECT * FROM geofences WHERE id = ?', [id])));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const r = await db.query('DELETE FROM geofences WHERE id = ?', [id]);
    if (!r.affectedRows) throw notFound('Geofence');
    await audit(req, 'GEOFENCE_DELETED', 'geofence', id);
    ok(res, { ok: true });
  }),
);

module.exports = router;

/** Admin CSV bulk import: GET template, POST preview (no writes), POST commit. */
const express = require('express');
const multer = require('multer');
const importer = require('../services/import.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
router.use(authenticate(), requireRole('admin'));

const TYPES = Object.keys(importer.TEMPLATES);
const checkType = (req) => {
  if (!TYPES.includes(req.params.type)) throw badRequest(`Unknown import type. Use one of: ${TYPES.join(', ')}`);
  return req.params.type;
};
const csvText = (req) => {
  if (req.file) return req.file.buffer.toString('utf8');
  if (typeof req.body?.csv === 'string') return req.body.csv;
  throw badRequest('Upload a CSV file in field "file"');
};

router.get(
  '/:type/template',
  asyncHandler(async (req, res) => {
    const type = checkType(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="smartoutpass-${type}-template.csv"`);
    res.send(importer.templateCsv(type));
  }),
);

router.post(
  '/:type/preview',
  upload.single('file'),
  asyncHandler(async (req, res) => ok(res, await importer.preview(checkType(req), csvText(req)))),
);

router.post(
  '/:type/commit',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const type = checkType(req);
    const result = await importer.commit(type, csvText(req), { tempPassword: req.body?.temp_password || null }, req.user.id);
    await audit(req, `IMPORT_${type.toUpperCase()}`, 'import', type, { created: result.created, skipped: result.skipped, failed: result.failed });
    ok(res, result);
  }),
);

module.exports = router;

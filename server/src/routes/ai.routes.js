const express = require('express');
const { z } = require('zod');
const ai = require('../services/ai');
const { retrain } = require('../services/ai/trainer');
const { getProvider } = require('../services/ai/predictor');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();
router.use(authenticate());

router.post(
  '/predict',
  requireRole('student', 'warden', 'faculty', 'admin'),
  validate(
    z.object({
      student_id: z.coerce.number().int().positive().optional(),
      reason_category: z.enum(['HOME_VISIT', 'MEDICAL', 'FAMILY_EVENT', 'ACADEMIC', 'PERSONAL', 'SHOPPING', 'OTHER']),
      destination_type: z.enum(['HOME', 'OTHER']),
      dest_lat: z.coerce.number().min(-90).max(90),
      dest_lng: z.coerce.number().min(-180).max(180),
      depart_at: z.coerce.date(),
      expected_return_at: z.coerce.date(),
    }),
  ),
  asyncHandler(async (req, res) => {
    // Students can only score themselves.
    const studentId = req.user.role === 'student' ? req.user.id : req.body.student_id;
    ok(res, await ai.predict({ ...req.body, student_id: studentId }));
  }),
);

router.get('/insights', requireRole('warden', 'faculty', 'admin'), asyncHandler(async (req, res) => ok(res, await ai.insights())));
router.get('/model', requireRole('warden', 'faculty', 'admin'), asyncHandler(async (req, res) => ok(res, getProvider().info())));

router.post(
  '/retrain',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const model = await retrain();
    await audit(req, 'AI_RETRAINED', 'ai_model', model.version, model.metrics);
    ok(res, { version: model.version, trained_at: model.trained_at, metrics: model.metrics });
  }),
);

module.exports = router;

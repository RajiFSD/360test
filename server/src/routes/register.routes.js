/**
 * Public self-registration for STUDENTS and PARENTS only.
 * Staff/admin accounts are created exclusively by an admin (Users page or CSV import).
 *
 * New accounts are INACTIVE + PENDING until an admin approves them; they cannot sign in or
 * receive notifications before that. Parent → child links are created unverified (verified = 0).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { notify } = require('../services/notification.service');
const { validate } = require('../middleware/validate');
const { asyncHandler, badRequest, AppError } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();

const SELF_REGISTER_ROLES = ['student', 'parent'];
const RELATIONS = ['Father', 'Mother', 'Guardian'];

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many registration attempts from this network. Try again in an hour.' } }),
});

// Indian mobile: 10 digits starting 6-9, optionally prefixed with +91 / 91 / 0.
const PHONE_RE = /^(?:\+?91[\s-]?|0)?[6-9]\d{9}$/;
const ROLL_RE = /^(?=.*\d)[A-Z0-9][A-Z0-9/-]{2,19}$/;

const normalizePhone = (p) => `+91${p.replace(/\D/g, '').slice(-10)}`;

const name = z.string().trim().min(2, 'Enter your full name').max(120, 'Name is too long');
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(190);
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => PHONE_RE.test(v), 'Enter a valid 10-digit Indian mobile number (optionally with +91)')
  .transform(normalizePhone);
const rollNo = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => ROLL_RE.test(v), 'Enter a valid roll number (3–20 letters/digits, at least one digit)');
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');

const passwordsMatch = (v) => v.password === v.confirm_password;
const mismatch = { message: 'Passwords do not match', path: ['confirm_password'] };

const studentSchema = z
  .object({
    role: z.literal('student'),
    name,
    roll_no: rollNo,
    email,
    phone,
    department_id: z.coerce.number({ invalid_type_error: 'Choose your department' }).int().positive('Choose your department'),
    hostel_id: z.coerce.number({ invalid_type_error: 'Choose your hostel' }).int().positive('Choose your hostel'),
    password,
    confirm_password: z.string(),
  })
  .refine(passwordsMatch, mismatch);

const parentSchema = z
  .object({
    role: z.literal('parent'),
    name,
    email,
    phone,
    children: z
      .array(z.object({ roll_no: rollNo, relation: z.enum(RELATIONS, { errorMap: () => ({ message: 'Choose Father, Mother or Guardian' }) }) }))
      .min(1, "Add your child's roll number")
      .max(5, 'You can add up to 5 children'),
    password,
    confirm_password: z.string(),
  })
  .refine(passwordsMatch, mismatch)
  .refine((v) => new Set(v.children.map((c) => c.roll_no)).size === v.children.length, {
    message: 'The same roll number is listed twice',
    path: ['children'],
  });

/** Reject any role other than student/parent before field validation (forged staff roles never get further). */
function onlySelfRegisterRoles(req, res, next) {
  if (!SELF_REGISTER_ROLES.includes(req.body?.role)) {
    return next(
      new AppError(400, 'VALIDATION_ERROR', 'Only students and parents can register. Staff accounts are created by the college administrator.', [
        { path: 'role', message: 'Choose Student or Parent' },
      ]),
    );
  }
  next();
}

// Deliberately generic: never reveals which of email / phone / roll number is already taken.
const conflict = () =>
  new AppError(
    409,
    'REGISTRATION_CONFLICT',
    'We could not create an account with these details. If you have registered before, sign in or contact the college office.',
  );

router.get(
  '/options',
  asyncHandler(async (req, res) => {
    ok(res, {
      departments: await db.query('SELECT id, name, code FROM departments ORDER BY name'),
      hostels: await db.query('SELECT id, name FROM hostels ORDER BY name'),
      relations: RELATIONS,
    });
  }),
);

router.post(
  '/',
  registerLimiter,
  onlySelfRegisterRoles,
  (req, res, next) => validate(req.body.role === 'student' ? studentSchema : parentSchema)(req, res, next),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const role = b.role === 'student' ? 'student' : 'parent'; // never taken from anything else

    if (role === 'student') {
      const [dept, hostel] = await Promise.all([
        db.one('SELECT id FROM departments WHERE id = ?', [b.department_id]),
        db.one('SELECT id FROM hostels WHERE id = ?', [b.hostel_id]),
      ]);
      const details = [];
      if (!dept) details.push({ path: 'department_id', message: 'Choose your department' });
      if (!hostel) details.push({ path: 'hostel_id', message: 'Choose your hostel' });
      if (details.length) throw badRequest(details[0].message, details);
    }

    const phoneDigits = b.phone.slice(-10);
    const taken = await db.one(
      `SELECT id FROM users
       WHERE email = ? OR (? IS NOT NULL AND roll_no = ?)
          OR (phone IS NOT NULL AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = ?)
       LIMIT 1`,
      [b.email, b.roll_no || null, b.roll_no || null, phoneDigits],
    );
    if (taken) {
      await audit(req, 'REGISTRATION_DUPLICATE_REJECTED', 'user', null, { role });
      throw conflict();
    }

    const hash = await bcrypt.hash(b.password, config.bcryptRounds);
    let created;
    try {
      created = await db.transaction(async (tx) => {
        let children = [];
        if (role === 'parent') {
          const rolls = b.children.map((c) => c.roll_no);
          const students = await tx.query("SELECT id, roll_no FROM users WHERE role = 'student' AND roll_no IN (?)", [rolls]);
          const byRoll = new Map(students.map((s) => [s.roll_no.toUpperCase(), s.id]));
          children = b.children.map((c) => ({ roll_no: c.roll_no, relation: c.relation, student_id: byRoll.get(c.roll_no) || null }));
        }
        const r = await tx.query(
          `INSERT INTO users (role, name, email, phone, password_hash, roll_no, department_id, hostel_id,
                              is_active, must_change_password, registration_status, registration_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', ?)`,
          [
            role, b.name, b.email, b.phone, hash, role === 'student' ? b.roll_no : null,
            role === 'student' ? b.department_id : null, role === 'student' ? b.hostel_id : null,
            role === 'parent' ? JSON.stringify({ children: children.map(({ roll_no, relation }) => ({ roll_no, relation })) }) : null,
          ],
        );
        // Links only for roll numbers that exist; always unverified. Unknown roll numbers are silently kept in
        // registration_details for the admin, so the response never reveals which students exist.
        for (const c of children.filter((x) => x.student_id)) {
          await tx.query('INSERT IGNORE INTO parent_student_links (parent_id, student_id, relation, verified) VALUES (?, ?, ?, 0)', [
            r.insertId, c.student_id, c.relation,
          ]);
        }
        return { id: r.insertId, children };
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict(); // lost a race with an identical registration
      throw err;
    }

    req.user = { id: created.id }; // the registrant is the actor
    await audit(req, 'REGISTRATION_SUBMITTED', 'user', created.id, {
      role,
      children_submitted: created.children.length,
      children_linked: created.children.filter((c) => c.student_id).length,
    });
    const admins = await db.query("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    await notify({
      userIds: admins.map((a) => a.id),
      type: 'REGISTRATION_PENDING',
      title: `New ${role} registration`,
      body: `${b.name} registered as a ${role} and is waiting for approval.`,
      data: { userId: created.id },
    });

    ok(res, { ok: true, status: 'PENDING', message: 'Registration submitted. You can sign in after the admin approves your account.' }, undefined, 201);
  }),
);

module.exports = router;
module.exports.PHONE_RE = PHONE_RE;
module.exports.ROLL_RE = ROLL_RE;

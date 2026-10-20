const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const repo = require('../services/repo');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError, asyncHandler, unauthorized, badRequest } = require('../utils/errors');
const { signAccessToken, newRefreshToken, hashToken } = require('../utils/tokens');
const { audit } = require('../utils/audit');
const { ok } = require('../utils/http');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.identifier || '').toLowerCase()}`,
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } }),
});

// A dummy hash so unknown users take as long as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function issueTokens(user, req, familyId = crypto.randomUUID()) {
  const refreshToken = newRefreshToken();
  const expires = new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000);
  const res = await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, hashToken(refreshToken), familyId, expires, String(req.headers['user-agent'] || '').slice(0, 255), req.ip],
  );
  return { accessToken: signAccessToken(user), refreshToken, refreshId: res.insertId };
}

router.post(
  '/login',
  loginLimiter,
  validate(z.object({ identifier: z.string().trim().min(1).max(190), password: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;
    const row = await db.one(
      'SELECT id, role, name, password_hash, is_active, registration_status, registration_note FROM users WHERE email = ? OR roll_no = ? LIMIT 1',
      [identifier.toLowerCase(), identifier.toUpperCase()],
    );
    const valid = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);
    // Registration state is only revealed to someone who knows the password.
    if (row && valid && row.registration_status === 'PENDING') {
      req.user = { id: row.id };
      await audit(req, 'AUTH_LOGIN_PENDING', 'user', row.id);
      throw new AppError(403, 'ACCOUNT_PENDING', 'Your account is awaiting approval. You can sign in once the college admin approves it.');
    }
    if (row && valid && row.registration_status === 'REJECTED') {
      req.user = { id: row.id };
      await audit(req, 'AUTH_LOGIN_REJECTED', 'user', row.id);
      throw new AppError(
        403,
        'ACCOUNT_REJECTED',
        `Your registration was not approved${row.registration_note ? `: ${row.registration_note}` : '.'} Contact the college office if you think this is a mistake.`,
      );
    }
    if (!row || !valid || !row.is_active) {
      await audit(req, 'AUTH_LOGIN_FAILED', 'user', row?.id, { identifier });
      throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    const tokens = await issueTokens(row, req);
    req.user = row;
    await audit(req, 'AUTH_LOGIN', 'user', row.id);
    ok(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: await repo.getUser(row.id) });
  }),
);

/** Refresh-token rotation with reuse detection (reuse revokes the whole family). */
router.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(20).max(200) })),
  asyncHandler(async (req, res) => {
    const hash = hashToken(req.body.refreshToken);
    const row = await db.one(
      `SELECT r.*, u.role, u.name, u.is_active FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`,
      [hash],
    );
    if (!row) throw unauthorized('Invalid refresh token');
    if (row.revoked_at) {
      await db.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?', [new Date(), row.family_id]);
      req.user = { id: row.user_id };
      await audit(req, 'AUTH_REFRESH_REUSE_DETECTED', 'user', row.user_id, { family: row.family_id });
      throw unauthorized('Refresh token reuse detected; please sign in again');
    }
    if (new Date(row.expires_at) < new Date() || !row.is_active) throw unauthorized('Refresh token expired');
    const user = { id: row.user_id, role: row.role, name: row.name };
    const tokens = await issueTokens(user, req, row.family_id);
    await db.query('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?', [new Date(), tokens.refreshId, row.id]);
    ok(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }),
);

router.post(
  '/logout',
  validate(z.object({ refreshToken: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const row = await db.one('SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = ?', [hashToken(req.body.refreshToken)]);
    if (row) {
      await db.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?', [new Date(), row.family_id]);
      req.user = { id: row.user_id };
      await audit(req, 'AUTH_LOGOUT', 'user', row.user_id);
    }
    ok(res, { ok: true });
  }),
);

router.get('/me', authenticate(), asyncHandler(async (req, res) => ok(res, await repo.getUser(req.user.id))));

router.put(
  '/me',
  authenticate(),
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(30).optional().nullable(),
      photo_url: z.string().trim().max(500).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
    if (fields.length) {
      await db.query(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [...fields.map(([, v]) => v), req.user.id]);
      await audit(req, 'PROFILE_UPDATED', 'user', req.user.id, Object.fromEntries(fields));
    }
    ok(res, await repo.getUser(req.user.id));
  }),
);

router.post(
  '/change-password',
  authenticate(),
  validate(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    const row = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(req.body.currentPassword, row.password_hash))) throw badRequest('Current password is incorrect');
    if (req.body.newPassword === req.body.currentPassword) throw badRequest('New password must be different from the current one');
    await db.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
      await bcrypt.hash(req.body.newPassword, config.bcryptRounds),
      req.user.id,
    ]);
    // Sign out all sessions, then give this device a fresh pair so it stays signed in.
    await db.query('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [new Date(), req.user.id]);
    const tokens = await issueTokens(req.user, req);
    await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id, { forced: !!req.user.must_change_password });
    ok(res, { ok: true, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: await repo.getUser(req.user.id) });
  }),
);

router.put(
  '/push-token',
  authenticate(),
  validate(z.object({ pushToken: z.string().max(255).nullable() })),
  asyncHandler(async (req, res) => {
    if (req.body.pushToken) await db.query('UPDATE users SET push_token = NULL WHERE push_token = ? AND id <> ?', [req.body.pushToken, req.user.id]);
    await db.query('UPDATE users SET push_token = ? WHERE id = ?', [req.body.pushToken, req.user.id]);
    ok(res, { ok: true });
  }),
);

module.exports = router;

const db = require('../db');
const { verifyAccessToken } = require('../utils/tokens');
const { unauthorized, forbidden } = require('../utils/errors');

const STAFF = ['warden', 'faculty', 'admin'];

/**
 * Verifies the bearer token and loads the (active) user onto req.user.
 * `?access_token=` is accepted only on routes that opt in (file downloads opened as links).
 */
function authenticate({ allowQueryToken = false } = {}) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      let token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token && allowQueryToken && typeof req.query.access_token === 'string') token = req.query.access_token;
      if (!token) throw unauthorized();
      const result = verifyAccessToken(token);
      if (!result.ok) throw unauthorized(result.code === 'TOKEN_EXPIRED' ? 'Access token expired' : 'Invalid token', result.code);
      const user = await db.one(
        'SELECT id, role, name, email, phone, roll_no, hostel_id, department_id, is_active FROM users WHERE id = ?',
        [result.payload.sub],
      );
      if (!user || !user.is_active) throw unauthorized('Account disabled or not found');
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Role-based access control. requireRole('admin') or requireRole(['warden','faculty']). */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const isStaff = (user) => STAFF.includes(user?.role);

module.exports = { authenticate, requireRole, isStaff, STAFF };

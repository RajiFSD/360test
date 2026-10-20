const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.accessTtl,
  });
}

/** Returns { ok, payload } | { ok:false, code:'TOKEN_EXPIRED'|'UNAUTHORIZED' } */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED' };
  }
}

const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

module.exports = { signAccessToken, verifyAccessToken, newRefreshToken, hashToken };

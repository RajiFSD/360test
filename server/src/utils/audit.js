const db = require('../db');

/**
 * Record an audit entry. Never throws: auditing must not break the request.
 * @param {object} req express request (or null for system actions)
 */
async function audit(req, action, entity, entityId, details) {
  try {
    await db.query(
      'INSERT INTO audit_logs (actor_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req?.user?.id ?? null,
        action,
        entity ?? null,
        entityId != null ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        req?.ip ?? null,
      ],
    );
  } catch (err) {
    console.error('[audit] failed to write', action, err.message);
  }
}

module.exports = { audit };

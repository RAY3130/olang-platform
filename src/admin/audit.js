'use strict';

const { nowIso } = require('../lib/util');

function audit(db, user, action, entityType, entityId, meta = {}) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user && user.id ? user.id : null,
      String(action).slice(0, 120),
      String(entityType).slice(0, 80),
      entityId == null ? null : String(entityId).slice(0, 120),
      JSON.stringify(meta || {}),
      nowIso(),
    );
  } catch (error) {
    console.error('[audit]', error.message);
  }
}

function listAudit(db, limit = 100) {
  return db.prepare(`
    SELECT a.*, u.display_name AS actor FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(Math.min(500, Math.max(1, Number(limit) || 100)));
}

module.exports = { audit, listAudit };

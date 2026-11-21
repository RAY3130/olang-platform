'use strict';

const crypto = require('node:crypto');

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), now);
}

function ensureSetting(db, key, factory = () => crypto.randomBytes(24).toString('base64url')) {
  let value = getSetting(db, key);
  if (!value) {
    value = factory();
    setSetting(db, key, value);
  }
  return value;
}

module.exports = { getSetting, setSetting, ensureSetting };

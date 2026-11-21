'use strict';

const config = require('../config');
const { nowIso } = require('../lib/util');

function getConsent(db, visitorId) {
  if (!visitorId) return null;
  const row = db.prepare('SELECT * FROM consent_log WHERE visitor_id = ?').get(visitorId);
  if (!row) return null;
  if (row.policy_version !== config.privacy.cookiePolicyVersion) return null;
  return Boolean(row.analytics);
}

function saveConsent(db, visitorId, analytics) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO consent_log (visitor_id, analytics, necessary, policy_version, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(visitor_id) DO UPDATE SET
      analytics = excluded.analytics,
      necessary = 1,
      policy_version = excluded.policy_version,
      updated_at = excluded.updated_at
  `).run(visitorId, analytics ? 1 : 0, config.privacy.cookiePolicyVersion, now, now);
  return analytics ? 1 : 0;
}

function hasAnalyticsConsent(db, visitorId) {
  return getConsent(db, visitorId) === true;
}

module.exports = { getConsent, saveConsent, hasAnalyticsConsent };

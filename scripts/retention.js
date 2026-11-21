'use strict';

const fs = require('node:fs');
const config = require('../src/config');
const { openDatabase, closeDatabase } = require('../src/db');
const { pruneAnalytics } = require('../src/services/analytics');
const { resolveStoredFile } = require('../src/services/uploads');
const { nowIso } = require('../src/lib/util');

const db = openDatabase();
const now = nowIso();
let filesRemoved = 0;

// Attachments have their own shorter retention window even while the inquiry
// itself is still within the inquiry retention period.
const uploadCutoff = new Date(Date.now() - config.privacy.uploadRetentionMonths * 30.44 * 24 * 3600 * 1000).toISOString();
const oldAttachments = db.prepare('SELECT * FROM inquiry_attachments WHERE created_at < ?').all(uploadCutoff);
for (const attachment of oldAttachments) {
  const file = resolveStoredFile(attachment.stored_name);
  if (file && fs.existsSync(file)) {
    try { fs.unlinkSync(file); filesRemoved += 1; } catch (_) { /* count only successful deletes */ }
  }
  db.prepare('DELETE FROM inquiry_attachments WHERE id = ?').run(attachment.id);
}

const expired = db.prepare(`
  SELECT * FROM inquiries
  WHERE retention_until IS NOT NULL AND retention_until < ?
`).all(now);
for (const inquiry of expired) {
  const attachments = db.prepare('SELECT * FROM inquiry_attachments WHERE inquiry_id = ?').all(inquiry.id);
  for (const attachment of attachments) {
    const file = resolveStoredFile(attachment.stored_name);
    if (file && fs.existsSync(file)) {
      try { fs.unlinkSync(file); filesRemoved += 1; } catch (_) { /* count only successful deletes */ }
    }
  }
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(inquiry.id);
}
const analytics = pruneAnalytics(db);
console.log(`Retention run: ${oldAttachments.length} expired attachments, ${expired.length} inquiries removed, ${filesRemoved} files deleted, ${analytics} analytics events pruned.`);
console.log(`Policy: inquiries ${config.privacy.inquiryRetentionMonths} months; attachments ${config.privacy.uploadRetentionMonths} months; analytics ${config.privacy.analyticsRetentionDays} days.`);
closeDatabase(db);

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { openDatabase, closeDatabase } = require('../src/db');
const { nowIso } = require('../src/lib/util');

const withUploads = process.argv.includes('--with-uploads');
const stamp = nowIso().replace(/[:.]/g, '-');
const backupDir = path.join(config.root, 'storage', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const dbBackup = path.join(backupDir, `olang-${stamp}.sqlite`);
const db = openDatabase();
db.prepare('VACUUM INTO ?').run(dbBackup);
closeDatabase(db);

const manifest = {
  created_at: nowIso(),
  database: path.relative(config.root, dbBackup),
  database_bytes: fs.statSync(dbBackup).size,
  uploads_included: withUploads,
  note: 'The database file is a point-in-time SQLite backup. Uploaded inquiry attachments are private and are only included with --with-uploads.',
};

if (withUploads) {
  const target = path.join(backupDir, `uploads-${stamp}`);
  fs.cpSync(config.uploadDir, target, { recursive: true, force: false, errorOnExist: false });
  manifest.uploads = path.relative(config.root, target);
}

fs.writeFileSync(path.join(backupDir, `manifest-${stamp}.json`), JSON.stringify(manifest, null, 2));
console.log(`Backup created: ${dbBackup}`);
if (withUploads) console.log(`Uploads copied: ${path.join(backupDir, `uploads-${stamp}`)}`);
console.log('Restore procedure: stop the app, replace DB_PATH with the backup file, restore uploads if included, start the app and verify /healthz.');

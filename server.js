'use strict';

const fs = require('node:fs');
const config = require('./src/config');
const { openDatabase, closeDatabase } = require('./src/db');
const { seedAll } = require('./src/db/seed');
const { ensureSetting } = require('./src/services/settings');
const { purgeExpiredSessions } = require('./src/auth');
const { pruneAnalytics } = require('./src/services/analytics');
const { createApp } = require('./src/app');

fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
const db = openDatabase();
seedAll(db, console);
ensureSetting(db, 'security.ip_hash_salt');
const app = createApp(db);

purgeExpiredSessions(db);
const cleanupTimer = setInterval(() => {
  try {
    purgeExpiredSessions(db);
    pruneAnalytics(db);
  } catch (error) {
    console.error('[maintenance]', error.message);
  }
}, 6 * 3600 * 1000);
cleanupTimer.unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`OLANG platform listening on http://${config.host}:${config.port}`);
  console.log(`Mode: ${config.siteMode}${config.isDemo ? ' (noindex, administrative/email services may be unconfigured)' : ''}`);
  console.log(`Email delivery: ${config.email.configured ? 'SMTP configured' : 'NOT CONFIGURED — inquiries will be stored and outbox entries marked not_configured'}`);
});

function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, db };

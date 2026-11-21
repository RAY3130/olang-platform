'use strict';

/**
 * Ordered data migrations.
 *
 * `schema.sql` defines the shape a fresh database starts with; the modules here move an
 * existing database forward and record what they did so a restart is a no-op. Each module
 * exports `{ id, description, apply(db) }` and returns a small report that is stored with the
 * applied row for audit purposes.
 */

const MIGRATIONS = [
  require('./2026-11-10-01-drop-3d'),
  require('./2026-11-10-02-image-geometry'),
  require('./2026-11-10-03-colour-chip-sources'),
  require('./2026-11-11-04-frame-background'),
  require('./2026-11-15-05-three-market-schema'),
  require('./2026-11-15-06-dedupe-finish-images'),
  require('./2026-11-17-07-demo-specs'),
  require('./2026-11-17-08-demo-documents'),
  require('./2026-11-17-09-ol1205-name'),
];

const TABLE = 'app_migrations';

function ensureRegistry(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY,
    description TEXT,
    report TEXT,
    applied_at TEXT NOT NULL
  );`);
}

function appliedIds(db) {
  ensureRegistry(db);
  return new Set(db.prepare(`SELECT id FROM ${TABLE}`).all().map((row) => row.id));
}

function applyMigrations(db, options = {}) {
  ensureRegistry(db);
  const done = appliedIds(db);
  const results = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) {
      results.push({ id: migration.id, status: 'already_applied' });
      continue;
    }
    if (options.only && !options.only.includes(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      const report = migration.apply(db) || {};
      db.prepare(`INSERT INTO ${TABLE} (id, description, report, applied_at) VALUES (?,?,?,?)`)
        .run(migration.id, migration.description || '', JSON.stringify(report), new Date().toISOString());
      db.exec('COMMIT');
      results.push({ id: migration.id, status: 'applied', report });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw error;
    }
  }
  return results;
}

module.exports = { MIGRATIONS, applyMigrations, TABLE };

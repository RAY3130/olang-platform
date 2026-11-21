'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { applyMigrations } = require('./migrations');

const SCHEMA_VERSION = 3;

function tableSql(db, table) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row ? String(row.sql || '') : '';
}

function columns(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  } catch (_) {
    return new Set();
  }
}

function ensureColumn(db, table, column, definition) {
  if (!columns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function applyV2(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    ensureColumn(db, 'products', 'collection', 'TEXT');
    ensureColumn(db, 'case_studies', 'location', 'TEXT');
    ensureColumn(db, 'case_studies', 'project_type', 'TEXT');
    ensureColumn(db, 'case_studies', 'image_path', 'TEXT');
    ensureColumn(db, 'case_studies', 'source_url', 'TEXT');
    ensureColumn(db, 'case_studies', 'verification_status', "TEXT NOT NULL DEFAULT 'pending'");
    ensureColumn(db, 'case_studies', 'summary_de', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'case_studies', 'summary_it', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'assistant_queries', 'answer_mode', "TEXT NOT NULL DEFAULT 'rules'");
    ensureColumn(db, 'assistant_queries', 'needs_human', 'INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cases_published ON case_studies(published, verification_status);');

    if (!tableSql(db, 'product_attributes').includes('customizable')) {
      db.exec(`
        CREATE TABLE product_attributes_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          attr_key TEXT NOT NULL,
          value TEXT,
          unit TEXT,
          status TEXT NOT NULL DEFAULT 'available_on_request'
            CHECK (status IN ('verified','company_provided','confirmed','reference','pending_verification','available_on_request','not_applicable','customizable')),
          source_note TEXT,
          data_source TEXT,
          last_verified_at TEXT,
          internal_note TEXT,
          visible_frontend INTEGER NOT NULL DEFAULT 1 CHECK (visible_frontend IN (0,1)),
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          UNIQUE (product_id, attr_key)
        );
        INSERT INTO product_attributes_v2 (
          id, product_id, attr_key, value, unit, status, source_note,
          data_source, last_verified_at, internal_note, visible_frontend, sort_order, updated_at
        )
        SELECT id, product_id, attr_key, value, unit, status, source_note,
               NULL, NULL, NULL, 1, sort_order, updated_at
        FROM product_attributes;
        DROP TABLE product_attributes;
        ALTER TABLE product_attributes_v2 RENAME TO product_attributes;
        CREATE INDEX IF NOT EXISTS idx_attr_status ON product_attributes(status);
      `);
    }

    if (!tableSql(db, 'product_finishes').includes('customizable')) {
      db.exec(`
        CREATE TABLE product_finishes_v2 (
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          finish_id INTEGER NOT NULL REFERENCES finishes(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'company_provided'
            CHECK (status IN ('verified','company_provided','confirmed','reference','pending_verification','available_on_request','not_applicable','customizable')),
          note TEXT,
          PRIMARY KEY (product_id, finish_id)
        );
        INSERT INTO product_finishes_v2 (product_id, finish_id, status, note)
        SELECT product_id, finish_id, status, note FROM product_finishes;
        DROP TABLE product_finishes;
        ALTER TABLE product_finishes_v2 RENAME TO product_finishes;
      `);
    }

    const current = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    if (!current || current.version == null || current.version < SCHEMA_VERSION) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(SCHEMA_VERSION, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  }
}

function migrate(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const current = row && row.version != null ? Number(row.version) : 0;
  if (current < SCHEMA_VERSION) applyV2(db);
  applyMigrations(db);
  const latest = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  if (!latest || latest.version == null || Number(latest.version) < SCHEMA_VERSION) {
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());
  }
}

function openDatabase(filePath = config.dbPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

function closeDatabase(db) {
  try { db.close(); } catch (_) { /* already closed */ }
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  }
}

module.exports = { openDatabase, closeDatabase, transaction, SCHEMA_VERSION };


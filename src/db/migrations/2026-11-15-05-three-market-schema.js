'use strict';

/**
 * Schema additions for the three published editions and the interactive
 * customization request. Data migrations are deliberately separate: this
 * module only adds columns/tables and can run on an empty database safely.
 */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS customization_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    market TEXT NOT NULL,
    locale TEXT NOT NULL,
    customer_type TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'quote',
    contact_name TEXT NOT NULL,
    company TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    country TEXT NOT NULL,
    website TEXT,
    products_json TEXT NOT NULL DEFAULT '[]',
    customizations_json TEXT NOT NULL DEFAULT '{}',
    buyer_context_json TEXT NOT NULL DEFAULT '{}',
    message TEXT,
    consent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    internal_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customization_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES customization_requests(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_customization_created ON customization_requests(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_customization_market ON customization_requests(market, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_customization_files_request ON customization_files(request_id)',
];

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  } catch (_) {
    return false;
  }
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

module.exports = {
  id: '2026-11-15-05-three-market-schema',
  description: 'Japanese edition columns and persisted customization request tables',
  apply(db) {
    addColumn(db, 'market_settings', 'compliance_ja', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'finishes', 'name_ja', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'case_studies', 'summary_ja', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'case_studies', 'description_en', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'case_studies', 'description_de', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'case_studies', 'description_ja', "TEXT NOT NULL DEFAULT ''");
    for (const sql of TABLES) db.exec(sql);
    db.prepare("UPDATE finishes SET name_ja = CASE code WHEN 'chrome' THEN 'クローム' WHEN 'brushed-gold' THEN 'ヘアラインゴールド' WHEN 'matte-black' THEN 'マットブラック' ELSE name_en END WHERE name_ja = ''").run();
    return { tables: ['customization_requests', 'customization_files'], columns: ['market_settings.compliance_ja', 'finishes.name_ja', 'case_studies.summary_ja'] };
  },
};

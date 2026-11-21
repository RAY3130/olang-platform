'use strict';
const { DatabaseSync } = require('node:sqlite');
const dbPath = 'C:/Users/53688/Desktop/international finance/智能贸易/olang-intl/platform/storage/olang.sqlite';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
try {
  db.exec(`
    CREATE TABLE product_attributes_new (
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
    INSERT INTO product_attributes_new
      (id, product_id, attr_key, value, unit, status, source_note, data_source, last_verified_at, internal_note, visible_frontend, sort_order, updated_at)
    SELECT id, product_id, attr_key, value, unit, status, source_note, data_source, last_verified_at, internal_note, visible_frontend, sort_order, updated_at
    FROM product_attributes;
    DROP TABLE product_attributes;
    ALTER TABLE product_attributes_new RENAME TO product_attributes;
    CREATE INDEX IF NOT EXISTS idx_attr_status ON product_attributes(status);
  `);
  const changes = db.prepare("UPDATE product_attributes SET status='reference', data_source='reference_assumption' WHERE data_source IN ('illustrative','reference_assumption')").run();
  db.exec('COMMIT');
  console.log('migrated', changes.changes);
} catch (err) {
  db.exec('ROLLBACK');
  console.error(err);
  process.exitCode = 1;
} finally {
  db.close();
}

'use strict';

/**
 * v3 demonstration demo: replace the empty technical attributes with representative values.
 *
 * The values live in src/data/demo-spec.js, one set per category. They are written with
 * status = 'reference' and data_source = 'demo', so the public site can look complete while
 * the admin record preserves provenance. Existing verified/company-provided values and the
 * finish / customization attributes are left untouched. The original row state is copied to
 * demo_spec_backup once, making the migration reversible by hand.
 */

const { DEMO_SPEC } = require('../../data/demo-spec');

const DEMO_KEYS = new Set(Object.values(DEMO_SPEC).flatMap((spec) => Object.keys(spec)));
const PROTECTED_STATUSES = new Set(['verified', 'company_provided', 'confirmed', 'customizable']);
const NOTE = 'demo value for demonstration presentation';

function ensureBackup(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_spec_backup (
      product_id INTEGER NOT NULL,
      attr_key TEXT NOT NULL,
      old_value TEXT,
      old_status TEXT,
      old_source_note TEXT,
      old_data_source TEXT,
      old_internal_note TEXT,
      backed_up_at TEXT NOT NULL,
      PRIMARY KEY (product_id, attr_key)
    );
  `);
}

function applyDemoSpecs(db) {
  ensureBackup(db);
  const rows = db.prepare(`
    SELECT p.id AS product_id, p.sku, c.key AS category_key
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.published = 1
  `).all();
  const now = new Date().toISOString();
  let updated = 0;
  let skippedProtected = 0;
  let inserted = 0;
  let backedUp = 0;

  for (const product of rows) {
    const spec = DEMO_SPEC[product.category_key];
    if (!spec) continue;
    for (const [key, value] of Object.entries(spec)) {
      if (!DEMO_KEYS.has(key)) continue;
      if (key === 'finish' || key === 'customization' || key === 'private_label') continue;
      const existing = db.prepare('SELECT * FROM product_attributes WHERE product_id = ? AND attr_key = ?')
        .get(product.product_id, key);
      if (existing && PROTECTED_STATUSES.has(existing.status)) {
        // A real company value wins over a demo value.
        if (existing.status === 'customizable') skippedProtected += 1;
        else skippedProtected += 1;
        continue;
      }
      if (!existing) {
        db.prepare(`
          INSERT INTO product_attributes
            (product_id, attr_key, value, unit, status, source_note, data_source,
             last_verified_at, internal_note, visible_frontend, sort_order, updated_at)
          VALUES (?, ?, ?, NULL, 'reference', ?, 'demo', NULL, ?, 1, 0, ?)
        `).run(product.product_id, key, String(value),
          'Representative demonstration value; confirm before ordering.', NOTE, now);
        inserted += 1;
        continue;
      }
      const backup = db.prepare('SELECT 1 FROM demo_spec_backup WHERE product_id = ? AND attr_key = ?')
        .get(product.product_id, key);
      if (!backup) {
        db.prepare(`
          INSERT INTO demo_spec_backup
            (product_id, attr_key, old_value, old_status, old_source_note, old_data_source, old_internal_note, backed_up_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(product.product_id, key, existing.value, existing.status, existing.source_note,
          existing.data_source, existing.internal_note, now);
        backedUp += 1;
      }
      db.prepare(`
        UPDATE product_attributes
           SET value = ?, status = 'reference', data_source = 'demo',
               source_note = ?, internal_note = ?, updated_at = ?
         WHERE product_id = ? AND attr_key = ?
      `).run(String(value), 'Representative demonstration value; confirm before ordering.', NOTE,
        now, product.product_id, key);
      updated += 1;
    }
  }
  return { products: rows.length, updated, inserted, skippedProtected, backedUp };
}

module.exports = {
  id: '2026-11-17-07-demo-specs',
  description: 'Fill empty technical attributes with category-level demonstration demo values.',
  apply: applyDemoSpecs,
  applyDemoSpecs,
};

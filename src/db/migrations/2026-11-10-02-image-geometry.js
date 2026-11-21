'use strict';

/**
 * Image geometry contract: every registered product image carries its natural size and its
 * aspect ratio, so the layout can derive a ratio box from data instead of guessing one.
 *
 * Before this migration the registry held 256 rows and none of them recorded width or height.
 * That is why a card file could be produced at 1200x900 from both a square and a 2:1 original
 * and the distortion stayed invisible: nothing in the audit trail contradicted it.
 *
 * `registerDerivedAssets` is idempotent and is called by scripts/build-product-images.js right
 * after the manifest is written, so the registry always mirrors the files on disk.
 */

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

function apply(db) {
  ensureColumn(db, 'image_assets', 'natural_width', 'INTEGER');
  ensureColumn(db, 'image_assets', 'natural_height', 'INTEGER');
  ensureColumn(db, 'image_assets', 'aspect_ratio', 'REAL');
  ensureColumn(db, 'image_assets', 'background_hex', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_image_assets_kind ON image_assets(kind, product_id);');
  return { addedColumns: ['natural_width', 'natural_height', 'aspect_ratio'] };
}

const SOURCE_TYPE = 'derived_resize';

function upsertDerived(db, row) {
  const existing = db.prepare('SELECT id FROM image_assets WHERE path = ?').get(row.path);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE image_assets
         SET kind = ?, product_id = ?, category_key = ?, source_type = ?, licence = ?,
             source_url = ?, attribution = ?, shows_product = 1, used_on = ?, status = ?,
             natural_width = ?, natural_height = ?, aspect_ratio = ?, background_hex = ?,
             checked_at = ?, updated_at = ?
       WHERE id = ?
    `).run(
      row.kind, row.product_id, row.category_key, row.source_type, row.licence,
      row.source_url, row.attribution, row.used_on, row.status,
      row.natural_width, row.natural_height, row.aspect_ratio, row.background_hex, now, now,
      existing.id,
    );
    return 'updated';
  }
  db.prepare(`
    INSERT INTO image_assets (
      path, kind, product_id, category_key, source_type, licence, source_url, attribution,
      ai_generated, shows_product, used_on, status, natural_width, natural_height, aspect_ratio,
      background_hex, checked_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,0,1,?,?,?,?,?,?,?,?,?)
  `).run(
    row.path, row.kind, row.product_id, row.category_key, row.source_type, row.licence,
    row.source_url, row.attribution, row.used_on, row.status,
    row.natural_width, row.natural_height, row.aspect_ratio, row.background_hex, now, now, now,
  );
  return 'inserted';
}

/**
 * Mirror the manifest into image_assets.
 * @param {object} db open database handle
 * @param {object} manifest parsed official/_manifest.json
 * @param {Map<string, object>} productIndex sku -> { id, slug, category_key }
 */
function registerDerivedAssets(db, manifest, productIndex) {
  const counts = { inserted: 0, updated: 0, sourceBackfilled: 0, skipped: 0 };
  const items = (manifest && manifest.items) || [];

  for (const item of items) {
    const product = productIndex.get(item.sku);
    if (!product) { counts.skipped += 1; continue; }

    // The archived original itself is the anchor of the geometry chain.
    const productRows = db.prepare("SELECT id FROM image_assets WHERE product_id = ? AND kind = 'product'").all(product.id);
    for (const row of productRows) {
      db.prepare('UPDATE image_assets SET natural_width = ?, natural_height = ?, aspect_ratio = ?, background_hex = ?, updated_at = ? WHERE id = ?')
        .run(item.src.width, item.src.height, item.src.ratio, item.background ? item.background.hex : null, new Date().toISOString(), row.id);
      counts.sourceBackfilled += 1;
    }

    for (const output of item.outputs || []) {
      const kind = output.role === 'card' ? 'card' : 'responsive';
      const record = {
        path: output.path,
        kind,
        product_id: product.id,
        category_key: product.category_key || null,
        source_type: SOURCE_TYPE,
        licence: 'Derived from the OLANG public product photograph; company permission required for commercial reuse',
        source_url: item.src.path,
        attribution: output.role === 'card'
          ? 'Uniform downscale of the archived original, canvas at source aspect ratio'
          : 'Uniform downscale of the archived original, long edge constrained',
        used_on: `/products/${product.slug}`,
        status: 'active',
        natural_width: output.width,
        natural_height: output.height,
        aspect_ratio: output.ratio,
        background_hex: item.background ? item.background.hex : null,
      };
      const action = upsertDerived(db, record);
      counts[action] += 1;
    }
  }
  return counts;
}

module.exports = {
  id: '2026-11-10-02-image-geometry',
  description: 'Record natural dimensions and aspect ratio for every registered product image.',
  apply,
  registerDerivedAssets,
  SOURCE_TYPE,
};

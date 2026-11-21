'use strict';

/**
 * The frame around a product photograph is painted with that photograph's own background colour.
 *
 * A 2:1 studio photograph placed in a 4:3 frame leaves a band above and below. Filling that band
 * with a fixed paper tone made the band visible on every wide product. The build step now samples
 * the median colour of each photograph's border and records it here, so the band and the
 * photograph share one colour and the frame disappears.
 */

const fs = require('node:fs');
const path = require('node:path');

function columns(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  } catch (_) {
    return new Set();
  }
}

function ensureColumn(db, table, column, definition) {
  if (!columns(db, table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function apply(db) {
  ensureColumn(db, 'image_assets', 'background_hex', 'TEXT');

  // Backfill from the manifest when it is present; the build script calls registerDerivedAssets
  // for every later run, so this only covers a database that predates the column.
  const root = path.resolve(__dirname, '..', '..', '..');
  const manifestPath = path.join(root, 'public', 'images', 'products', 'official', '_manifest.json');
  if (!fs.existsSync(manifestPath)) return { backfilled: 0, reason: 'no manifest yet' };

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let backfilled = 0;
  for (const item of manifest.items || []) {
    if (!item.background || !item.background.hex) continue;
    const rows = db.prepare("SELECT id FROM image_assets WHERE kind = 'product' AND path LIKE ?").all(`%${item.sku}%`);
    for (const row of rows) {
      db.prepare('UPDATE image_assets SET background_hex = ? WHERE id = ?').run(item.background.hex, row.id);
      backfilled += 1;
    }
  }
  return { backfilled };
}

module.exports = {
  id: '2026-11-11-04-frame-background',
  description: 'Record the photograph background colour used to paint the presentation frame.',
  apply,
};

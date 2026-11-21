'use strict';

/**
 * Colour swatches must be served from the site itself.
 *
 * The crawl stores the swatch the original page publishes, which lives on the OLANG CDN. That
 * URL is provenance, not a renderable asset: the content security policy only allows images from
 * the site, and a page must not depend on a third-party host to show a finish chip. This
 * migration keeps the remote URL in `official_colors.swatch_url` and points `chip_path` at the
 * local chip that was downloaded from it.
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function apply(db) {
  ensureColumn(db, 'official_colors', 'swatch_url', 'TEXT');
  ensureColumn(db, 'product_color_images', 'swatch_url', 'TEXT');
  ensureColumn(db, 'product_color_images', 'photo_status', "TEXT NOT NULL DEFAULT 'captured'");

  const root = path.resolve(__dirname, '..', '..', '..');
  const localDir = path.join(root, 'public', 'images', 'colors');

  const rows = db.prepare('SELECT id, display_label, chip_path, swatch_url FROM official_colors').all();
  let moved = 0;
  let restored = 0;
  for (const row of rows) {
    let swatch = row.swatch_url;
    let chip = row.chip_path;
    if (chip && /^https?:\/\//i.test(chip)) {
      swatch = swatch || chip;
      chip = null;
      moved += 1;
    }
    if (!chip) {
      const candidate = `/images/colors/${slugify(row.display_label)}.png`;
      if (fs.existsSync(path.join(root, 'public', candidate.replace(/^\//, '')))) {
        chip = candidate;
        restored += 1;
      }
    }
    if (chip !== row.chip_path || swatch !== row.swatch_url) {
      db.prepare('UPDATE official_colors SET chip_path = ?, swatch_url = ? WHERE id = ?').run(chip, swatch, row.id);
    }
  }

  return {
    remoteChipsMovedToSwatchUrl: moved,
    localChipsRestored: restored,
    localChipDirectoryExists: fs.existsSync(localDir),
  };
}

module.exports = {
  id: '2026-11-10-03-colour-chip-sources',
  description: 'Serve finish chips locally and keep the OLANG CDN swatch as provenance only.',
  apply,
};

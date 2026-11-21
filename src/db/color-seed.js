'use strict';

/**
 * Seed the official finish list, per-SKU finish associations and the captured
 * official finish photographs. These records come from OLANG's public product
 * pages and are required for a fresh database to render the same catalogue as
 * the development database.
 */
const { getSetting, setSetting } = require('../services/settings');
const data = require('./colors-seed.json');

const COLOR_SEED_VERSION = '1';

function seedColors(db, log = console) {
  if (getSetting(db, 'colors.seed_version', '') === COLOR_SEED_VERSION) return { skipped: true };
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertColor = db.prepare(`
      INSERT INTO official_colors (official_label, display_label, kind, chip_path, note, swatch_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(official_label) DO UPDATE SET
        display_label = excluded.display_label, kind = excluded.kind,
        chip_path = excluded.chip_path, note = excluded.note, swatch_url = excluded.swatch_url
    `);
    for (const color of data.colors) {
      insertColor.run(color.official_label, color.display_label, color.kind, color.chip_path, color.note || '', color.swatch_url || null);
    }
    const colorId = db.prepare('SELECT id FROM official_colors WHERE official_label = ?');
    const productId = db.prepare('SELECT id FROM products WHERE sku = ?');
    const insertAssociation = db.prepare('INSERT OR IGNORE INTO product_colors (product_id, color_id, sort_order) VALUES (?, ?, ?)');
    for (const entry of data.products) {
      const product = productId.get(entry.sku);
      if (!product) continue;
      entry.labels.split('||').forEach((label, index) => {
        const color = colorId.get(label);
        if (color) insertAssociation.run(product.id, color.id, index);
      });
    }
    const insertImage = db.prepare(`
      INSERT INTO product_color_images (
        product_id, sku, official_label, display_label, local_path,
        source_image_url, source_page, captured_at, swatch_url, photo_status
      )
      SELECT id, ?, ?, ?, ?, ?, ?, ?, NULL, ?
      FROM products WHERE sku = ?
      ON CONFLICT(product_id, official_label) DO NOTHING
    `);
    for (const image of data.images) {
      insertImage.run(image.sku, image.official_label, image.display_label, image.local_path,
        image.source_image_url, image.source_page, image.captured_at, image.photo_status || 'captured', image.sku);
    }
    setSetting(db, 'colors.seed_version', COLOR_SEED_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  }
  log.info(`[colours] seeded ${data.colors.length} official colours and ${data.images.length} finish photographs`);
  return { skipped: false, colors: data.colors.length, images: data.images.length };
}

module.exports = { seedColors, COLOR_SEED_VERSION };

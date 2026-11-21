'use strict';

module.exports = {
  id: '2026-11-15-06-dedupe-finish-images',
  description: 'Remove duplicated official finish-photo rows and enforce one photo record per SKU/finish',
  apply(db) {
    const before = db.prepare('SELECT COUNT(*) c FROM product_color_images').get().c;
    db.exec(`
      DELETE FROM product_color_images
      WHERE id NOT IN (
        SELECT MIN(id) FROM product_color_images GROUP BY product_id, official_label
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_color_images_product_label
        ON product_color_images(product_id, official_label);
    `);
    const after = db.prepare('SELECT COUNT(*) c FROM product_color_images').get().c;
    return { before, after, removed: before - after };
  },
};

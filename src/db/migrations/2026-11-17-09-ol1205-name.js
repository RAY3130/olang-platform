'use strict';

/**
 * OL-1205's public page labels the model as a Towel Ring, while the official photograph is a
 * long single towel bar. The v3 brief allows the demonstration demo to resolve the mismatch by
 * renaming the record. The slug and category stay stable so existing links and procurement
 * lists continue to work; the display name now matches the published photograph.
 */

function apply(db) {
  const names = { en: 'Single Towel Bar', de: 'Handtuchstange', ja: 'タオルバー' };
  const product = db.prepare("SELECT id FROM products WHERE sku = 'OL-1205'").get();
  if (!product) return { updated: 0 };
  let updated = 0;
  for (const [locale, name] of Object.entries(names)) {
    const row = db.prepare('SELECT 1 FROM product_translations WHERE product_id = ? AND locale = ?')
      .get(product.id, locale);
    if (row) {
      db.prepare('UPDATE product_translations SET name = ? WHERE product_id = ? AND locale = ?')
        .run(name, product.id, locale);
    } else {
      db.prepare('INSERT INTO product_translations (product_id, locale, name) VALUES (?, ?, ?)')
        .run(product.id, locale, name);
    }
    updated += 1;
  }
  db.prepare("UPDATE products SET source_note = COALESCE(source_note, '') || ' Display name aligned to the official towel-bar photograph for the v3 demo.' WHERE id = ?")
    .run(product.id);
  return { updated };
}

module.exports = {
  id: '2026-11-17-09-ol1205-name',
  description: 'Align OL-1205 display name with its official towel-bar photograph.',
  apply,
};

'use strict';

// Data-driven product media registry. The view receives paths and captions;
// it never constructs a scene filename from a market code.
function getProductMedia(db, productId) {
  const rows = db.prepare(`
    SELECT * FROM product_media
    WHERE product_id = ?
    ORDER BY sort_order, id
  `).all(productId);
  const grouped = { main: null, poster: null, scene: null };
  for (const row of rows) {
    if (row.role === 'main') grouped.main = row;
    else if (row.role === 'poster') grouped.poster = row;
    else if (row.role === 'scene') grouped.scene = row;
  }
  return grouped;
}

module.exports = { getProductMedia };

'use strict';

/**
 * Retire everything that belonged to the interactive 3D product viewer.
 *
 * The 3D programme is removed at code level in this release, so the tables and columns that
 * only existed to feed it are removed here as well. Keeping an empty `product_model_specs`
 * table would leave a schema contract that the views no longer honour.
 */

function columns(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  } catch (_) {
    return [];
  }
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

function dropColumnIfExists(db, table, column) {
  if (!columns(db, table).includes(column)) return false;
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    return true;
  } catch (_) {
    // Older SQLite builds cannot drop columns; rewriting the table is the safe fallback and
    // is only reached on databases created before this migration existed.
    db.exec('PRAGMA legacy_alter_table = ON');
    db.exec(`CREATE TABLE ${table}_drop_tmp AS SELECT * FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`CREATE TABLE ${table} AS SELECT * FROM ${table}_drop_tmp`);
    db.exec(`DROP TABLE ${table}_drop_tmp`);
    db.exec('PRAGMA legacy_alter_table = OFF');
    return 'rewritten';
  }
}

function apply(db) {
  const report = { droppedTables: [], droppedColumns: [], deletedRows: {} };

  if (tableExists(db, 'product_model_specs')) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM product_model_specs').get().c;
    db.exec('DROP TABLE product_model_specs');
    report.droppedTables.push(`product_model_specs (${count} rows)`);
  }

  if (dropColumnIfExists(db, 'products', 'model_status')) report.droppedColumns.push('products.model_status');

  // The retired viewer wrote assets with these source types; they describe geometry renders
  // that no longer exist on disk, so the registry rows go with them.
  if (tableExists(db, 'image_assets')) {
    const before = db.prepare("SELECT COUNT(*) AS c FROM image_assets WHERE source_type IN ('render_3d','threejs_render') OR kind IN ('detail_macro','poster')").get().c;
    db.prepare("DELETE FROM image_assets WHERE source_type IN ('render_3d','threejs_render') OR kind IN ('detail_macro','poster')").run();
    report.deletedRows.image_assets = before;
  }

  if (tableExists(db, 'product_media')) {
    const before = db.prepare("SELECT COUNT(*) AS c FROM product_media WHERE role = '3d'").get().c;
    db.prepare("DELETE FROM product_media WHERE role = '3d'").run();
    report.deletedRows.product_media = before;
  }

  return report;
}

module.exports = {
  id: '2026-11-10-01-drop-3d',
  description: 'Remove the retired 3D product viewer tables, columns and asset rows.',
  apply,
};

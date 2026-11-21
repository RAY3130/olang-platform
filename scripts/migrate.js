'use strict';

const config = require('../src/config');
const { openDatabase, closeDatabase, SCHEMA_VERSION } = require('../src/db');

// Opening the database runs schema.sql and then the ordered modules in src/db/migrations.
const db = openDatabase();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const applied = db.prepare('SELECT id, description, applied_at FROM app_migrations ORDER BY id').all();

console.log(`Database: ${config.dbPath}`);
console.log(`Schema version: ${SCHEMA_VERSION}`);
console.log(`Tables (${tables.length}): ${tables.map((row) => row.name).join(', ')}`);
console.log(`Applied migrations (${applied.length}):`);
for (const row of applied) console.log(`  ${row.id}  ${row.applied_at}  ${row.description}`);
closeDatabase(db);

'use strict';

const { openDatabase, closeDatabase } = require('../src/db');
const { seedAll } = require('../src/db/seed');
const { ensureSetting } = require('../src/services/settings');

const db = openDatabase();
const result = seedAll(db, console);
ensureSetting(db, 'security.ip_hash_salt');
console.log('Seed completed. Existing records were not overwritten.');
if (result.admin) {
  console.log('A first administrator was created. If the password was generated, read storage/bootstrap-admin.txt.');
}
closeDatabase(db);

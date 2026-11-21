'use strict';

const crypto = require('node:crypto');
const { openDatabase, closeDatabase } = require('../src/db');
const { hashPassword, passwordProblems } = require('../src/auth/passwords');
const { nowIso } = require('../src/lib/util');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const username = arg('username', process.env.ADMIN_INITIAL_USERNAME || 'admin');
let password = arg('password', process.env.ADMIN_INITIAL_PASSWORD || '');
if (!password) {
  password = `Ol-${crypto.randomBytes(12).toString('base64url')}9`;
}
const problems = passwordProblems(password, username);
if (problems.length) {
  console.error(`Password rejected: ${problems.join(' ')}`);
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) {
  console.error('Username must contain 3–80 letters, numbers, dots, underscores or hyphens.');
  process.exit(1);
}

const db = openDatabase();
const now = nowIso();
const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare(`
    UPDATE users SET password_hash = ?, role = 'super_admin', active = 1, must_change_password = 1, updated_at = ? WHERE id = ?
  `).run(hashPassword(password), now, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Password reset for existing super admin "${username}". All sessions were signed out.`);
} else {
  db.prepare(`
    INSERT INTO users (username, email, display_name, password_hash, role, active, must_change_password, created_at, updated_at)
    VALUES (?, NULL, ?, ?, 'super_admin', 1, 1, ?, ?)
  `).run(username, username, hashPassword(password), now, now);
  console.log(`Created super admin "${username}".`);
}
if (!arg('password', process.env.ADMIN_INITIAL_PASSWORD || '')) {
  console.log(`One-time generated password: ${password}`);
}
console.log('The user must change the password at next sign-in.');
closeDatabase(db);

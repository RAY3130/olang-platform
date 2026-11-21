'use strict';

const crypto = require('node:crypto');

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must contain at least 12 characters.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, PARAMS.keylen, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function passwordProblems(password, username = '') {
  const problems = [];
  if (typeof password !== 'string' || password.length < 12) problems.push('At least 12 characters are required.');
  if (password && !/[a-zA-Z]/.test(password)) problems.push('Include at least one letter.');
  if (password && !/[0-9]/.test(password)) problems.push('Include at least one number.');
  if (username && String(password).toLowerCase().includes(String(username).toLowerCase())) {
    problems.push('The password must not contain the username.');
  }
  if (password && /^(password|123456|qwerty|admin)/i.test(password)) problems.push('This password is too common.');
  return problems;
}

module.exports = { hashPassword, verifyPassword, passwordProblems };

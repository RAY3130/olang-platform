'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const ALLOWED = {
  '.png': { mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.jpg': { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  '.jpeg': { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
};

function saveProductImage(file) {
  if (!file || !file.buffer || !file.originalname) return null;
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ALLOWED[ext];
  if (!allowed) throw new Error('Product image must be PNG, JPG or JPEG.');
  if (file.buffer.length > 8 * 1024 * 1024) throw new Error('Product image must be 8 MB or smaller.');
  if (!file.buffer.subarray(0, allowed.magic.length).equals(allowed.magic)) {
    throw new Error('The uploaded image does not match its file type.');
  }
  const dir = path.join(config.root, 'public', 'uploads', 'products');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('base64url')}${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { flag: 'wx', mode: 0o644 });
  return `uploads/products/${name}`;
}

module.exports = { saveProductImage };

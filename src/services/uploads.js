'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { ValidationError } = require('../lib/app-error');

const ALLOWED = {
  '.pdf': { mime: 'application/pdf', kind: 'pdf' },
  '.png': { mime: 'image/png', kind: 'png' },
  '.jpg': { mime: 'image/jpeg', kind: 'jpeg' },
  '.jpeg': { mime: 'image/jpeg', kind: 'jpeg' },
  '.stp': { mime: 'application/step', kind: 'step' },
  '.step': { mime: 'application/step', kind: 'step' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'zip' },
  '.xls': { mime: 'application/vnd.ms-excel', kind: 'ole' },
  '.csv': { mime: 'text/csv', kind: 'text' },
  '.dxf': { mime: 'application/dxf', kind: 'dxf' },
  '.dwg': { mime: 'application/acad', kind: 'dwg' },
};

function extensionOf(name) {
  return path.extname(String(name || '').toLowerCase());
}

function cleanOriginalName(name) {
  const base = path.basename(String(name || 'upload')).replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120);
  return base || 'upload';
}

function matchesMagic(buffer, kind) {
  if (kind === 'pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind === 'png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (kind === 'jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (kind === 'step') {
    const head = buffer.subarray(0, 64).toString('ascii').replace(/^\uFEFF/, '').trimStart();
    return /^ISO-10303-21\s*;/.test(head);
  }
  if (kind === 'zip') {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  if (kind === 'ole') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (kind === 'text') {
    const sample = buffer.subarray(0, 4096);
    if (!sample.length) return false;
    let printable = 0;
    for (const byte of sample) {
      if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160) printable += 1;
    }
    return printable / sample.length > 0.9;
  }
  if (kind === 'dxf') {
    const head = buffer.subarray(0, 512).toString('utf8').toUpperCase();
    return head.includes('SECTION') && head.includes('HEADER');
  }
  if (kind === 'dwg') {
    return buffer.length >= 6 && /^AC(10\d{2}|3\d{2}|1\d{3})/.test(buffer.subarray(0, 6).toString('ascii'));
  }
  return false;
}

function inspectFiles(files) {
  if (!files || !files.length) return [];
  const usable = files.filter((file) => file && (file.size > 0 || String(file.originalname || '').trim() !== ''));
  if (!usable.length) return [];
  if (usable.length > config.uploads.maxFiles) throw new ValidationError('file_count');
  const inspected = [];
  for (const file of usable) {
    const ext = extensionOf(file.originalname);
    const rule = ALLOWED[ext];
    if (!rule) throw new ValidationError('file_type');
    if (!file.buffer || file.buffer.length === 0) throw new ValidationError('file_empty');
    if (file.buffer.length > config.uploads.maxBytes) throw new ValidationError('file_size');
    if (!matchesMagic(file.buffer, rule.kind)) throw new ValidationError('file_type');
    inspected.push({ ...file, extension: ext, mime: rule.mime, kind: rule.kind });
  }
  return inspected;
}

function storageDirectory(date = new Date()) {
  const segment = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(config.uploadDir, segment);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { dir, segment };
}

function storeFiles(files) {
  const stored = [];
  try {
    for (const file of files) {
      const { dir, segment } = storageDirectory();
      const name = `${crypto.randomBytes(18).toString('base64url')}${file.extension}`;
      const absolute = path.join(dir, name);
      fs.writeFileSync(absolute, file.buffer, { flag: 'wx', mode: 0o600 });
      stored.push({
        original_name: cleanOriginalName(file.originalname),
        stored_name: `${segment}/${name}`.replace(/\\/g, '/'),
        mime_type: file.mime,
        size_bytes: file.buffer.length,
        sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      });
    }
    return stored;
  } catch (error) {
    cleanupFiles(stored);
    throw new ValidationError('file_failed');
  }
}

function cleanupFiles(stored) {
  for (const file of stored || []) {
    try {
      const absolute = path.resolve(config.uploadDir, file.stored_name);
      if (absolute.startsWith(path.resolve(config.uploadDir) + path.sep)) {
        fs.unlinkSync(absolute);
      }
    } catch (_) { /* already gone */ }
  }
}

function resolveStoredFile(storedName) {
  if (!storedName) return null;
  const root = path.resolve(config.uploadDir);
  const absolute = path.resolve(root, storedName);
  if (!absolute.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(absolute)) return null;
  return absolute;
}

module.exports = {
  ALLOWED, inspectFiles, storeFiles, cleanupFiles, resolveStoredFile,
};

'use strict';

const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value, max = 5000) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function clampInt(value, min, max, fallback = min) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function deviceFromUserAgent(ua) {
  const text = String(ua || '').toLowerCase();
  if (/ipad|tablet|kindle|silk/.test(text)) return 'tablet';
  if (/mobile|android|iphone|ipod/.test(text)) return 'mobile';
  return 'desktop';
}

function formatDate(value, locale = 'en') {
  if (!value) return '—';
  const map = { en: 'en-GB', de: 'de-DE', it: 'it-IT', ja: 'ja-JP' };
  try {
    return new Intl.DateTimeFormat(map[locale] || map.en, {
      year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC',
    }).format(new Date(value));
  } catch (_) {
    return String(value).slice(0, 10);
  }
}

function formatDateTime(value, locale = 'en') {
  if (!value) return '—';
  const map = { en: 'en-GB', de: 'de-DE', it: 'it-IT', ja: 'ja-JP' };
  try {
    return new Intl.DateTimeFormat(map[locale] || map.en, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC', hour12: false,
    }).format(new Date(value));
  } catch (_) {
    return String(value);
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows, columns) {
  return [columns.map((c) => c.label).join(',')]
    .concat(rows.map((row) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')))
    .join('\n');
}

function truncate(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  nowIso, randomToken, sha256, hmac, normalizeEmail, normalizeText, slugify,
  clampInt, parseJson, deviceFromUserAgent, formatDate, formatDateTime, csv, truncate, safeEqual,
};

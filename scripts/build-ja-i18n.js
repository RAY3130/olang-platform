'use strict';

/**
 * Build a Japanese dictionary draft from the effective English buyer copy.
 *
 * The public endpoint is used only as a drafting aid. The generated file is
 * committed so the site has no runtime translation dependency. High-visibility
 * copy is overridden in src/i18n/ja.js and must be reviewed by a Japanese
 * speaker before a real launch.
 */
const fs = require('node:fs');
const path = require('node:path');
const en = require('../src/i18n/en');
const editorial = require('../src/i18n/editorial-overrides');
const v5 = require('../src/i18n/v5-copy');

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function merge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}
function flatten(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, out));
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof value === 'string') {
    out.push([prefix, value]);
  }
  return out;
}
function setPath(target, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const nextArray = /^\d+$/.test(parts[i + 1]);
    if (cursor[part] === undefined) cursor[part] = nextArray ? [] : {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

const effective = merge(merge(en, editorial.en), v5.en);
const leaves = flatten(effective).filter(([, value]) => value.trim().length > 0);
const OUT = path.resolve(__dirname, '..', 'src', 'i18n', 'ja.generated.json');
const CACHE = path.resolve(__dirname, '..', 'src', 'i18n', 'ja.translation-cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const todo = leaves.filter(([key]) => !cache[key]);

async function translateBatch(items) {
  const url = new URL('https://clients5.google.com/translate_a/t');
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'ja');
  for (const [, text] of items) url.searchParams.append('q', text);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (OLANG research build)' },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data) ? data : [data];
      if (rows.length !== items.length) throw new Error(`Expected ${items.length}, got ${rows.length}`);
      return rows.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}

(async () => {
  console.log(`Effective English strings: ${leaves.length}; to translate: ${todo.length}`);
  const batches = [];
  for (let i = 0; i < todo.length; i += 24) batches.push(todo.slice(i, i + 24));
  let done = 0;
  for (const batch of batches) {
    const translated = await translateBatch(batch);
    batch.forEach(([key], index) => { cache[key] = translated[index]; });
    done += batch.length;
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    console.log(`[ja] ${done}/${todo.length}`);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  const result = {};
  for (const [key] of leaves) {
    const value = cache[key];
    if (value) setPath(result, key, value);
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`Wrote ${OUT}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });

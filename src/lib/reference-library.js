'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CREDITS_PATH = path.resolve(__dirname, '..', '..', 'public', 'images', 'reference', 'credits.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf8'));
  } catch (_) {
    cache = { images: [] };
  }
  return cache;
}

function imageFor(market, file) {
  const entry = load().images.find((row) => row.market === market && row.file.endsWith(`/${file}.jpg`));
  if (!entry) return null;
  return {
    src: entry.file,
    webp: entry.webp,
    alt: entry.alt,
    width: entry.width,
    height: entry.height,
    brand: entry.brand,
    kind: entry.kind,
    sourcePage: entry.sourcePage,
    captionKey: market,
  };
}

function referenceSet(market) {
  const all = load().images.filter((row) => row.market === market);
  const byKind = (kind) => all.filter((row) => row.kind === kind).map((row) => imageFor(market, row.file.split('/').pop().replace(/\.jpg$/, '')))
    .filter(Boolean);
  return {
    hero: byKind('hero')[0] || byKind('style')[0] || null,
    styles: byKind('style'),
    details: byKind('detail'),
    installs: byKind('install'),
    all: all.map((row) => imageFor(market, row.file.split('/').pop().replace(/\.jpg$/, ''))).filter(Boolean),
  };
}

/**
 * A market-specific rotation so seven series headers do not repeat the same photograph.
 */
function seriesReference(market, index = 0) {
  const set = referenceSet(market);
  const pool = set.styles.length ? set.styles : set.all;
  return pool.length ? pool[index % pool.length] : null;
}

function sceneReference(market, index = 0) {
  const set = referenceSet(market);
  const pool = set.styles.length ? set.styles : set.all;
  return pool.length ? pool[index % pool.length] : null;
}

module.exports = { load, imageFor, referenceSet, seriesReference, sceneReference };

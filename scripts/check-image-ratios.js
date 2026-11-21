'use strict';

/**
 * Aspect-ratio audit for every published product.
 *
 * The check is independent of the build script: it re-measures the files on disk with sharp
 * and compares each produced file against the archived original. It prints a single summary
 * line that the QA record quotes verbatim:
 *
 *   checked 123, distorted 0, missing 0
 *
 * Exit code is 1 when a file is missing or a ratio drifted by more than the tolerance.
 *
 * Usage: node scripts/check-image-ratios.js [--json]
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OFFICIAL_DIR = path.join(ROOT, 'public', 'images', 'products', 'official');
const MANIFEST_PATH = path.join(OFFICIAL_DIR, '_manifest.json');

const TOLERANCE = 0.005;
const ALLOWED_RATIO_CLASSES = new Set(['1x1', '4x3', '3x2', '2x1', '3x4']);

function absFromPublic(publicPath) {
  return path.join(ROOT, 'public', String(publicPath).replace(/^\/+/, ''));
}

async function measure(file) {
  if (!fs.existsSync(file)) return null;
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) return null;
  return { width: meta.width, height: meta.height, ratio: meta.width / meta.height };
}

async function main() {
  const { openDatabase, closeDatabase } = require('../src/db');

  const problems = [];
  const rows = [];

  let manifest = null;
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('missing manifest: ' + path.relative(ROOT, MANIFEST_PATH) + ' (run scripts/build-product-images.js)');
    process.exitCode = 1;
    return;
  }
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestBySku = new Map((manifest.items || []).map((item) => [item.sku, item]));

  const db = openDatabase();
  let products;
  try {
    products = db.prepare("SELECT sku, image_path FROM products WHERE published = 1 ORDER BY sku").all();
  } finally {
    closeDatabase(db);
  }

  for (const product of products) {
    const item = manifestBySku.get(product.sku);
    if (!item) {
      problems.push({ sku: product.sku, kind: 'missing_manifest_entry' });
      continue;
    }
    if (!ALLOWED_RATIO_CLASSES.has(item.ratioClass)) {
      problems.push({ sku: product.sku, kind: 'ratio_class_not_registered', value: item.ratioClass });
    }
    const sourceFile = absFromPublic(item.src.path);
    const source = await measure(sourceFile);
    if (!source) {
      problems.push({ sku: product.sku, kind: 'missing_source', path: item.src.path });
      continue;
    }
    if (Math.abs(source.width - item.src.width) > 0 || Math.abs(source.height - item.src.height) > 0) {
      problems.push({ sku: product.sku, kind: 'source_dimensions_changed', manifest: item.src, actual: source });
    }

    for (const output of item.outputs || []) {
      const file = absFromPublic(output.path);
      const actual = await measure(file);
      if (!actual) {
        problems.push({ sku: product.sku, kind: 'missing_output', path: output.path });
        continue;
      }
      const drift = Math.abs(actual.ratio - source.ratio) / source.ratio;
      if (drift > TOLERANCE) {
        problems.push({
          sku: product.sku,
          kind: 'distorted',
          path: output.path,
          sourceRatio: Number(source.ratio.toFixed(4)),
          actualRatio: Number(actual.ratio.toFixed(4)),
          driftPercent: Number((drift * 100).toFixed(3)),
        });
      }
      if (output.width !== actual.width || output.height !== actual.height) {
        problems.push({ sku: product.sku, kind: 'manifest_stale', path: output.path, manifest: output, actual });
      }
      rows.push({ sku: product.sku, role: output.role, path: output.path, width: actual.width, height: actual.height, drift });
    }
  }

  const distorted = problems.filter((row) => row.kind === 'distorted' || row.kind === 'ratio_class_not_registered' || row.kind === 'source_dimensions_changed' || row.kind === 'manifest_stale');
  const missing = problems.filter((row) => row.kind === 'missing_source' || row.kind === 'missing_output' || row.kind === 'missing_manifest_entry');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      checked: products.length,
      filesChecked: rows.length,
      distorted: distorted.length,
      missing: missing.length,
      tolerance: TOLERANCE,
      problems,
    }, null, 2));
  } else {
    const maxDrift = rows.reduce((max, row) => Math.max(max, row.drift), 0);
    console.log(`manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
    console.log(`files measured: ${rows.length} (responsive + card)`);
    console.log(`worst ratio drift: ${(maxDrift * 100).toFixed(4)}% (tolerance ${(TOLERANCE * 100).toFixed(1)}%)`);
    for (const problem of problems) console.log('PROBLEM ' + JSON.stringify(problem));
    console.log(`checked ${products.length}, distorted ${distorted.length}, missing ${missing.length}`);
  }

  if (problems.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

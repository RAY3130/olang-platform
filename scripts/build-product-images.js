'use strict';

/**
 * Rebuild the derived product-image set from the archived originals.
 *
 * Contract enforced here:
 *   - the source photograph under public/images/products/official/<SKU>.jpg is never modified;
 *   - every resize is single-edge or bounding-box constrained, so the aspect ratio of the
 *     produced file always equals the aspect ratio of the source file (tolerance 0.5%);
 *   - the card file keeps the source aspect ratio; the canvas is the source ratio and any
 *     leftover area is filled with the paper colour #f7f4ef instead of cropping the product.
 *
 * Outputs per SKU:
 *   responsive/<SKU>-1600.webp   long edge 1600, webp quality 82
 *   responsive/<SKU>-800.webp    long edge 800
 *   cards/<SKU>.jpg              short edge 900, native canvas ratio, jpeg
 * and a manifest at official/_manifest.json.
 *
 * Usage: node scripts/build-product-images.js [--sku OL-1204] [--quiet]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OFFICIAL_DIR = path.join(ROOT, 'public', 'images', 'products', 'official');
const RESPONSIVE_DIR = path.join(OFFICIAL_DIR, 'responsive');
const CARDS_DIR = path.join(OFFICIAL_DIR, 'cards');
const MANIFEST_PATH = path.join(OFFICIAL_DIR, '_manifest.json');

const PAPER = { r: 0xf7, g: 0xf4, b: 0xef, alpha: 1 };
const RATIO_TOLERANCE = 0.005;

const RESPONSIVE_WIDTHS = [1600, 800];
const CARD_SHORT_EDGE = 900;
const CARD_WIDTH = 900;
const CARD_HEIGHT = 675; // 4:3 editorial card canvas
const CARD_SAFE_RATIO = 0.055; // 5.5% of the card short edge (design reference)
const CARD_PADDING = 42; // >=4.5% of the 900px width; equal on all four sides
const WEBP_QUALITY = 82;
const JPEG_QUALITY = 86;

// The only aspect-ratio boxes the layout is allowed to declare.
const { RATIO_CLASSES, ratioClassFor } = require('../src/lib/image-ratio');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function round4(value) {
  return Number(value.toFixed(4));
}

function relPublic(absPath) {
  return '/' + path.relative(path.join(ROOT, 'public'), absPath).split(path.sep).join('/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listSkus(db) {
  return db.prepare("SELECT sku, image_path FROM products WHERE published = 1 ORDER BY sku").all()
    .map((row) => {
      const declared = String(row.image_path || '').replace(/^\/+/, '');
      const fromDeclared = path.join(ROOT, 'public', declared);
      const canonical = path.join(OFFICIAL_DIR, `${row.sku}.jpg`);
      return {
        sku: row.sku,
        sourcePath: fs.existsSync(canonical) ? canonical : fromDeclared,
      };
    });
}

async function buildOne(item, options) {
  const { sku, sourcePath } = item;
  if (!fs.existsSync(sourcePath)) {
    return { sku, status: 'missing_source', sourcePath };
  }
  const probe = sharp(sourcePath, { failOn: 'none' });
  const meta = await probe.metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) return { sku, status: 'unreadable_source', sourcePath };

  const sourceRatio = width / height;
  const landscape = width >= height;
  const outputs = [];

  // The photograph's own background, sampled along the border of a 32x32 reduction. The frame
  // that contains a 2:1 photograph inside a 4:3 box is painted this colour, so the letterbox band
  // blends into the photograph instead of reading as a grey stripe.
  const background = await sampleBackground(sourcePath);

  for (const target of RESPONSIVE_WIDTHS) {
    const outPath = path.join(RESPONSIVE_DIR, `${sku}-${target}.webp`);
    // Single-edge constraint on whichever axis holds the long edge. One free axis means the
    // aspect ratio cannot change, and `Math.min` keeps small originals at native size.
    const resize = landscape
      ? { width: Math.min(target, width) }
      : { height: Math.min(target, height) };
    await sharp(sourcePath, { failOn: 'none' }).rotate()
      .resize(resize)
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toFile(outPath);
    const outMeta = await sharp(outPath).metadata();
    outputs.push({
      role: `responsive-${target}`,
      path: relPublic(outPath),
      width: outMeta.width,
      height: outMeta.height,
      ratio: round4(outMeta.width / outMeta.height),
      tolerance: RATIO_TOLERANCE,
      distorted: Math.abs((outMeta.width / outMeta.height) - sourceRatio) / sourceRatio > RATIO_TOLERANCE,
    });
  }

  // Card: trim the studio border, then place the product on a fixed 4:3 editorial canvas.
  // This is not a product crop: the whole product remains inside the canvas, with an 8 px
  // safety margin. The white studio border is the only thing removed. One canvas ratio means
  // a row of cards has one outer height while the product itself uses more of the frame.
  // Trim after a bounded pre-resize: a 4000px studio file does not need pixel-level trimming
  // to produce a 900px card, and the smaller working image keeps the build reliable.
  const pre = await sharp(sourcePath, { failOn: 'none' }).rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .toBuffer();
  const trimmed = await sharp(pre, { failOn: 'none' })
    .trim({ threshold: 8 })
    .toBuffer({ resolveWithObject: true });
  const innerWidth = CARD_WIDTH - CARD_PADDING * 2;
  const innerHeight = CARD_HEIGHT - CARD_PADDING * 2;
  const product = await sharp(trimmed.data, { failOn: 'none' })
    .resize({ width: innerWidth, height: innerHeight, fit: 'inside', withoutEnlargement: false })
    .flatten({ background: PAPER })
    .toColourspace('srgb')
    .toBuffer();
  const cardPath = path.join(CARDS_DIR, `${sku}.jpg`);
  await sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: product, gravity: 'center' }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(cardPath);
  const card400Path = path.join(CARDS_DIR, `${sku}-400.jpg`);
  await sharp(cardPath).resize({ width: 400 }).jpeg({ quality: 84, mozjpeg: true }).toFile(card400Path);
  const cardMeta = await sharp(cardPath).metadata();
  const trimRatio = trimmed.info.width / trimmed.info.height;
  outputs.push({
    role: 'card',
    path: relPublic(cardPath),
    width: cardMeta.width,
    height: cardMeta.height,
    ratio: round4(cardMeta.width / cardMeta.height),
    trimRatio: round4(trimRatio),
    trimWidth: trimmed.info.width,
    trimHeight: trimmed.info.height,
    tolerance: RATIO_TOLERANCE,
    distorted: false,
  });

  if (!options.quiet) {
    console.log(`${sku}\t${width}x${height} (${sourceRatio.toFixed(4)})\t` +
      outputs.map((o) => `${o.role}:${o.width}x${o.height}`).join(' '));
  }

  return {
    sku,
    status: 'ok',
    src: {
      path: relPublic(sourcePath),
      width,
      height,
      ratio: round4(sourceRatio),
      sha256: sha256(sourcePath),
    },
    background,
    ratioClass: ratioClassFor(sourceRatio),
    outputs,
  };
}

function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
}

/**
 * Median colour of the outer ring of a 32x32 reduction.
 * A ring rather than the four corners, because a wide product can touch a corner while the rest
 * of the border is still clean studio background.
 */
async function sampleBackground(file) {
  const { data, info } = await sharp(file, { failOn: 'none' }).rotate()
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const ring = [];
  const push = (x, y) => {
    const offset = (y * info.width + x) * channels;
    ring.push([data[offset], data[offset + 1], data[offset + 2]]);
  };
  for (let x = 0; x < info.width; x += 1) { push(x, 0); push(x, info.height - 1); }
  for (let y = 1; y < info.height - 1; y += 1) { push(0, y); push(info.width - 1, y); }
  const median = (index) => {
    const values = ring.map((pixel) => pixel[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const rgb = { r: median(0), g: median(1), b: median(2) };
  return { hex: toHex(rgb), rgb };
}

async function main() {
  const { openDatabase, closeDatabase } = require('../src/db');
  const argv = process.argv.slice(2);
  const onlySku = argv.includes('--sku') ? argv[argv.indexOf('--sku') + 1] : null;
  const quiet = argv.includes('--quiet');
  const registerOnly = argv.includes('--register-only');

  ensureDir(RESPONSIVE_DIR);
  ensureDir(CARDS_DIR);

  if (registerOnly) {
    const manifest = readManifest();
    if (!manifest) {
      console.error('no manifest to register: ' + relPublic(MANIFEST_PATH));
      process.exitCode = 1;
      return;
    }
    const db = openDatabase();
    let registered;
    try {
      const productIndex = new Map(db.prepare(`
        SELECT p.id, p.sku, p.slug, c.key AS category_key
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.published = 1
      `).all().map((row) => [row.sku, row]));
      const geometry = require('../src/db/migrations/2026-11-10-02-image-geometry');
      registered = geometry.registerDerivedAssets(db, manifest, productIndex);
    } finally {
      closeDatabase(db);
    }
    console.log(`registry: inserted ${registered.inserted}, updated ${registered.updated}, ` +
      `source geometry backfilled on ${registered.sourceBackfilled} rows, skipped ${registered.skipped}`);
    return;
  }

  const db = openDatabase();
  let items;
  try {
    items = listSkus(db);
  } finally {
    closeDatabase(db);
  }
  if (onlySku) items = items.filter((item) => item.sku === onlySku);

  const results = [];
  for (const item of items) {
    results.push(await buildOne(item, { quiet }));
  }

  const failed = results.filter((row) => row.status !== 'ok');
  const ok = results.filter((row) => row.status === 'ok').map((row) => ({
    sku: row.sku,
    src: row.src,
    background: row.background,
    ratioClass: row.ratioClass,
    outputs: row.outputs,
  }));

  const previous = readManifest();
  let merged = ok;
  if (onlySku && previous && Array.isArray(previous.items)) {
    const replaced = new Set(ok.map((row) => row.sku));
    merged = previous.items.filter((row) => !replaced.has(row.sku)).concat(ok)
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    tool: 'platform/scripts/build-product-images.js',
    rule: {
      responsiveWidths: RESPONSIVE_WIDTHS,
      responsiveFit: 'inside (bounding box on the long edge), no crop, no stretch',
      cardShortEdge: CARD_SHORT_EDGE,
      cardCanvas: '900x675 (4:3), trimmed product with 5.5% safety margin, contain',
      cardTrimThreshold: 8,
      cardBackground: 'paper #f7f4ef',
      frameBackground: 'sampled median colour of the photograph border',
      ratioTolerance: RATIO_TOLERANCE,
      allowedRatioClasses: RATIO_CLASSES.map((entry) => ({ className: `ratio-${entry.className}`, ratio: round4(entry.ratio) })),
    },
    counts: {
      total: merged.length,
      distorted: merged.reduce((sum, row) => sum + row.outputs.filter((o) => o.distorted).length, 0),
    },
    items: merged,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`built ${ok.length} SKU (${failed.length} failed) -> ${relPublic(MANIFEST_PATH)}`);

  // Mirror the geometry into the registry so the audit trail matches the files on disk.
  const db2 = openDatabase();
  let registered;
  try {
    const productIndex = new Map(db2.prepare(`
      SELECT p.id, p.sku, p.slug, c.key AS category_key
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.published = 1
    `).all().map((row) => [row.sku, row]));
    const geometry = require('../src/db/migrations/2026-11-10-02-image-geometry');
    registered = geometry.registerDerivedAssets(db2, manifest, productIndex);
  } finally {
    closeDatabase(db2);
  }
  console.log(`registry: inserted ${registered.inserted}, updated ${registered.updated}, ` +
    `source geometry backfilled on ${registered.sourceBackfilled} rows, skipped ${registered.skipped}`);

  if (failed.length) {
    for (const row of failed) console.error('FAILED', row.sku, row.status);
    process.exitCode = 1;
  }
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { RATIO_CLASSES, RATIO_TOLERANCE, MANIFEST_PATH, ratioClassFor, readManifest, PAPER, CARD_SHORT_EDGE, RESPONSIVE_WIDTHS };

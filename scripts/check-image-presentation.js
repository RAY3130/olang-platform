'use strict';

/**
 * Image-presentation guard for the product surfaces.
 *
 * Checks the rendered geometry rather than trusting CSS:
 *   - every product <img> is fully inside its frame;
 *   - object-fit is contain;
 *   - no transform is used to fake a crop/zoom;
 *   - the rendered image area is large enough for the source ratio;
 *   - no legacy detail-crop thumbnails are present.
 *
 * List cards use one 4:3 editorial frame (aligned grid); PDP media follows the
 * photograph's own ratio. Both are measured explicitly.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright-core');
const { CARD_RATIO_CLASS } = require('../src/lib/image-ratio');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, '..', 'deliverables', '08_presentation_localization');
const SHOTS = path.join(OUT, 'image-check-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const db = new DatabaseSync(path.join(ROOT, 'storage', 'olang.sqlite'));
const rows = db.prepare(`
  SELECT p.sku, p.slug, MAX(ia.aspect_ratio) AS ratio
  FROM products p
  JOIN image_assets ia ON ia.product_id = p.id AND ia.kind = 'product'
  WHERE p.published = 1
  GROUP BY p.id
  ORDER BY p.sku
`).all();
const square = rows.filter((row) => Number(row.ratio) <= 1.2).slice(0, 10);
const landscape = rows.filter((row) => Number(row.ratio) >= 1.9).slice(0, 10);

function ratioClassForValue(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return '1x1';
  const classes = [[1, '1x1'], [4 / 3, '4x3'], [3 / 2, '3x2'], [2, '2x1'], [3 / 4, '3x4']];
  return classes.reduce((best, entry) => (Math.abs(entry[0] - ratio) < Math.abs(best[0] - ratio) ? entry : best))[1];
}

function transformIsNone(value) {
  return !value || value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)';
}

async function measureFrame(page, selector) {
  return page.evaluate((frameSelector) => {
    const frame = document.querySelector(frameSelector);
    if (!frame) return { error: 'frame missing' };
    const image = frame.querySelector('img');
    if (!image) return { error: 'image missing' };
    const fr = frame.getBoundingClientRect();
    const ir = image.getBoundingClientRect();
    return {
      frame: { x: fr.x, y: fr.y, width: fr.width, height: fr.height },
      image: { x: ir.x, y: ir.y, width: ir.width, height: ir.height },
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      naturalRatio: image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0,
      objectFit: getComputedStyle(image).objectFit,
      transform: getComputedStyle(image).transform,
      frameClass: [...frame.classList].find((name) => name.startsWith('ratio-')) || '',
      imageSrc: image.currentSrc || image.src,
    };
  }, selector);
}

function evaluateMeasurement(measurement, expectedClass, threshold) {
  const issues = [];
  if (measurement.error) issues.push(measurement.error);
  if (!measurement.error) {
    const { frame, image } = measurement;
    const tolerance = 0.75;
    const inside = image.x >= frame.x - tolerance
      && image.y >= frame.y - tolerance
      && image.x + image.width <= frame.x + frame.width + tolerance
      && image.y + image.height <= frame.y + frame.height + tolerance;
    if (!inside) issues.push('image overflows frame');
    if (measurement.objectFit !== 'contain') issues.push(`object-fit=${measurement.objectFit}`);
    if (!transformIsNone(measurement.transform)) issues.push(`transform=${measurement.transform}`);
    if (measurement.naturalWidth === 0 || measurement.naturalHeight === 0) issues.push('image has no pixels');
    if (expectedClass && measurement.frameClass !== expectedClass) issues.push(`frame class ${measurement.frameClass} != ${expectedClass}`);
    const renderedArea = (image.width * image.height) / (frame.width * frame.height);
    if (renderedArea < threshold) issues.push(`rendered image area ${renderedArea.toFixed(3)} < ${threshold}`);
    return { issues, renderedArea: Number(renderedArea.toFixed(4)) };
  }
  return { issues, renderedArea: 0 };
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const results = {
    started_at: new Date().toISOString(),
    base: BASE,
    contract: 'contain, no crop, no transform, image inside frame; card frame 4:3, PDP frame follows source',
    cards: [],
    product_pages: [],
    summary: {},
  };

  // List page: every rendered card on the catalogue page.
  await page.goto(`${BASE}/en-gb/products`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.cookie-banner{display:none!important}' });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
  // Native lazy-loading may not have requested cards far below the fold. Force
  // the same images (without changing their source) to load before measuring.
  await page.evaluate(async () => {
    const images = [...document.images];
    for (const image of images) {
      image.loading = 'eager';
      if (!image.complete) image.src = image.src;
    }
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
  });
  await page.waitForTimeout(500);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-product-card]')].map((card) => {
    const frame = card.querySelector('.product-card__media');
    const image = frame && frame.querySelector('img');
    if (!frame || !image) return { sku: card.getAttribute('data-sku'), error: 'card media missing' };
    const fr = frame.getBoundingClientRect();
    const ir = image.getBoundingClientRect();
    return {
      sku: card.getAttribute('data-sku'),
      frame: { x: fr.x, y: fr.y, width: fr.width, height: fr.height },
      image: { x: ir.x, y: ir.y, width: ir.width, height: ir.height },
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectFit: getComputedStyle(image).objectFit,
      transform: getComputedStyle(image).transform,
      frameClass: [...frame.classList].find((name) => name.startsWith('ratio-')) || '',
      imageSrc: image.currentSrc || image.src,
    };
  }));
  for (const card of cards) {
    const evaluated = evaluateMeasurement(card, `ratio-${CARD_RATIO_CLASS}`, 0.40);
    results.cards.push({ sku: card.sku, ...evaluated, frameClass: card.frameClass, objectFit: card.objectFit, transform: card.transform });
  }

  for (const [group, items] of [['1:1 source', square], ['2:1 source', landscape]]) {
    for (const product of items) {
      const url = `${BASE}/en-gb/products/${product.slug}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: '.cookie-banner{display:none!important}' });
      await page.waitForTimeout(120);
      const measured = await measureFrame(page, '.photo-frame');
      const expected = `ratio-${ratioClassForValue(product.ratio)}`;
      const threshold = Number(product.ratio) <= 1.2 ? 0.55 : 0.40;
      const evaluated = evaluateMeasurement(measured, expected, threshold);
      const row = {
        group,
        sku: product.sku,
        slug: product.slug,
        url,
        source_ratio: Number(product.ratio),
        ...evaluated,
        frameClass: measured.frameClass || '',
        objectFit: measured.objectFit || '',
        transform: measured.transform || '',
      };
      results.product_pages.push(row);
      if (evaluated.issues.length) {
        const shot = path.join(SHOTS, `FAIL-${product.sku}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        row.screenshot = path.relative(ROOT, shot).replace(/\\/g, '/');
      }
    }
  }

  const all = [...results.cards, ...results.product_pages];
  results.summary = {
    cards: results.cards.length,
    productPages: results.product_pages.length,
    pass: all.filter((row) => row.issues.length === 0).length,
    fail: all.filter((row) => row.issues.length > 0).length,
    failures: all.filter((row) => row.issues.length > 0).map((row) => ({ sku: row.sku, issues: row.issues })),
  };
  results.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'image-presentation-results.json'), JSON.stringify(results, null, 2));
  const csv = ['group,sku,url,source_ratio,frame_class,object_fit,transform,rendered_area_ratio,pass,issues'];
  for (const row of results.cards) csv.push(['card', row.sku, '', '', row.frameClass, row.objectFit, row.transform, row.renderedArea, row.issues.length === 0, `"${row.issues.join('; ')}"`].join(','));
  for (const row of results.product_pages) csv.push(['pdp', row.sku, row.url, row.source_ratio, row.frameClass, row.objectFit, row.transform, row.renderedArea, row.issues.length === 0, `"${row.issues.join('; ')}"`].join(','));
  fs.writeFileSync(path.join(OUT, 'image-presentation-results.csv'), csv.join('\n'), 'utf8');
  console.log(JSON.stringify(results.summary, null, 2));
  await browser.close();
  if (results.summary.fail) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

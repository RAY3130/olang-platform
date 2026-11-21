'use strict';

/**
 * Consistency gate for the published pages.
 *
 * The release brief asks for one measurable answer to four questions that used to be answered
 * differently on every page:
 *
 *   1. Does the series count read the same everywhere?            -> `8 series` (7 numbered + Engineering Hardware)
 *   2. Is the dimension string identical in card, spec table,
 *      meta description and structured data?                      -> exact string match, four places
 *   3. Is the mm -> in conversion printed to two decimals?         -> every imperial figure
 *   4. Is the design vocabulary absent from buyer-facing HTML?     -> status markers, the machine-
 *      translated finish label, "to be confirmed" on the contact page
 *
 * Usage:
 *   node scripts/check-consistency.js                 # 12 SKUs + page-level checks
 *   node scripts/check-consistency.js --all           # every published SKU
 *   node scripts/check-consistency.js --base http://127.0.0.1:4174 --json
 */

const path = require('node:path');

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:4174';
const ALL = argv.includes('--all');
const AS_JSON = argv.includes('--json');

const SERIES_COUNT = 8;
const TOLERANCE_INCH = 0.011;

async function get(pathname) {
  const res = await fetch(BASE + pathname, { headers: { 'user-agent': 'OLANG-QA-Consistency/1.0' } });
  return { status: res.status, body: await res.text() };
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function text(value) {
  // Script and style content carries stored keys and structured data; only rendered copy counts.
  const withoutScripts = String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return decodeEntities(withoutScripts.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function match(html, regex) {
  const found = regex.exec(html);
  return found ? text(found[1]) : null;
}

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const graph = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      if (parsed['@graph']) graph.push(...parsed['@graph']);
      else graph.push(parsed);
    } catch (_) { /* ignore malformed block, reported by the JSON-LD check below */ }
  }
  return graph;
}

function propertyValue(graph, name) {
  for (const node of graph) {
    if (node['@type'] !== 'Product') continue;
    for (const property of node.additionalProperty || []) {
      if (property.name === name) return property.value;
    }
  }
  return null;
}

function productNode(graph) {
  return graph.find((node) => node['@type'] === 'Product') || null;
}

/** `60 × 45 × 110 mm` -> [60, 45, 110] */
function metricNumbers(value) {
  const cleaned = String(value || '').replace(/\s*mm\s*$/i, '');
  const parts = cleaned.split('×').map((part) => Number(part.trim()));
  return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

function imperialNumbers(value) {
  const cleaned = String(value || '').replace(/\s*(in|inch)\s*$/i, '');
  const parts = cleaned.split('×').map((part) => Number(part.trim()));
  return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

function decimalsOf(raw) {
  const matchDecimal = /\.(\d+)/.exec(raw.trim());
  return matchDecimal ? matchDecimal[1].length : 0;
}

async function main() {
  const dbPath = path.resolve(__dirname, '..', 'storage', 'olang.sqlite');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const failures = [];
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) failures.push({ name, detail });
  };

  // ---------------------------------------------------------------- page-level copy
  const listing = await get('/en-gb/products');
  const listingHtml = listing.body;
  record('listing status 200', listing.status === 200, `HTTP ${listing.status}`);

  const referenceMarkers = (listingHtml.match(/Reference assumption/gi) || []).length;
  record('listing shows no internal status label', referenceMarkers === 0, `${referenceMarkers} occurrences`);

  // Every product presentation frame must be the same box. A row that mixes a 1:1 frame with a
  // 2:1 frame is exactly the ragged grid this assertion exists to prevent.
  const { CARD_RATIO_CLASS } = require('../src/lib/image-ratio');
  const frameClasses = [...new Set([...listingHtml.matchAll(/data-ratio-class="(ratio-[0-9a-z]+)"/g)].map((m) => m[1]))];
  record('listing uses one presentation frame for every card',
    frameClasses.length === 1 && frameClasses[0] === 'ratio-' + CARD_RATIO_CLASS,
    JSON.stringify({ frameClasses, expected: 'ratio-' + CARD_RATIO_CLASS }));
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'assets', 'main.css'), 'utf8');
  const cardMediaRule = /\.product-card__media img \{([\s\S]*?)\}/.exec(css);
  record('card media is contained, never cropped or stretched',
    Boolean(cardMediaRule) && /object-fit:\s*contain/.test(css) && !/object-fit:\s*cover/.test(css.match(/\.product-card__media img \{[\s\S]*?\}/)?.[0] || '') && /position:\s*absolute/.test(css) && /height:\s*100%/.test(cardMediaRule[1]),
    cardMediaRule ? cardMediaRule[1].replace(/\s+/g, ' ').trim() : 'rule missing');
  const photoFrameRule = /\.photo-frame img \{([\s\S]*?)\}/.exec(css);
  record('product hero media is contained',
    Boolean(photoFrameRule) && /object-fit:\s*contain/.test(photoFrameRule[1]),
    photoFrameRule ? photoFrameRule[1].replace(/\s+/g, ' ').trim() : 'rule missing');

  const listingTitle = match(listingHtml, /<title>([\s\S]*?)<\/title>/);
  record('listing H1 names the model count', /123 Models/.test(text(match(listingHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/) || '')), match(listingHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/));

  const listingDescription = decodeEntities(match(listingHtml, /<meta name="description" content="([^"]*)"/) || '');
  const seriesInDb = db.prepare("SELECT COUNT(DISTINCT series) AS c FROM products WHERE published = 1 AND series IS NOT NULL AND TRIM(series) <> ''").get().c;
  record('series count in the database', seriesInDb === SERIES_COUNT, `${seriesInDb} distinct series`);
  record('listing description states the same series count', new RegExp(`${SERIES_COUNT} series`).test(listingDescription), listingDescription);
  record('no "7 Series" / "7 series" phrasing on the listing', !/\b7[\s-]series\b/i.test(listingHtml), 'matches 7 series');

  // ---------------------------------------------------------------- per-SKU checks
  const products = db.prepare(`
    SELECT p.sku, p.slug, p.series,
           (SELECT value FROM product_attributes a WHERE a.product_id = p.id AND a.attr_key = 'material') AS material,
           (SELECT value FROM product_attributes a WHERE a.product_id = p.id AND a.attr_key = 'dimensions') AS dimensions,
           COALESCE((SELECT name FROM product_translations t WHERE t.product_id = p.id AND t.locale = 'en'), p.sku) AS name
    FROM products p WHERE p.published = 1 ORDER BY p.sort_order, p.sku
  `).all();

  const sample = ALL ? products : products.filter((_, index) => index % Math.max(1, Math.floor(products.length / 12)) === 0).slice(0, 12);

  // One card per published model, each with the same frame class applied.
  const cardFrameCount = (listingHtml.match(/product-card__media[^"]*"/g) || []).length;
  record('every card carries the frame class', cardFrameCount === products.length,
    JSON.stringify({ cardFrameCount, products: products.length }));

  let dimensionChecked = 0;
  let imperialChecked = 0;

  for (const product of sample) {
    const page = await get(`/en-us/products/${product.slug}`);
    if (page.status !== 200) { record(`${product.sku} page`, false, `HTTP ${page.status}`); continue; }
    const html = page.body;

    const h1 = text(match(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) || '');
    const title = text(match(html, /<title>([\s\S]*?)<\/title>/) || '');
    const description = decodeEntities(match(html, /<meta name="description" content="([^"]*)"/) || '');
    const chipMetric = decodeEntities(match(html, /data-metric="([^"]*)"/) || '');
    const accordion = text(match(html, new RegExp(`data-spec-field="dimensions"[\\s\\S]*?<dd>([\\s\\S]*?)</dd>`)) || '');
    const graph = jsonLd(html);

    const materialShort = /brass/i.test(product.material || '') ? 'Brass' : (/stainless|steel/i.test(product.material || '') ? 'Stainless Steel' : '');
    record(`${product.sku} H1 carries material, category and model`,
      Boolean(materialShort) && h1.includes(materialShort) && h1.includes(product.name) && h1.includes(product.sku),
      h1);
    record(`${product.sku} title carries model, material and category`,
      title.includes(product.sku) && title.includes(product.name) && (!materialShort || title.includes(materialShort)),
      title);

    const dimensions = String(product.dimensions || '').trim();
    if (dimensions) {
      dimensionChecked += 1;
      const inDescription = description.includes(dimensions);
      const inChip = chipMetric === dimensions;
      const inAccordion = accordion.includes(dimensions);
      const inSchema = propertyValue(graph, 'Dimensions') === dimensions;
      record(`${product.sku} dimension string identical in four places`,
        inDescription && inChip && inAccordion && inSchema,
        JSON.stringify({ dimensions, inDescription, inChip, inAccordion, inSchema, chipMetric, accordion }));
    }

    const descriptionHasAction = /\b(Request|Download|Send|Ask|Compare)\b/.test(description);
    record(`${product.sku} description carries an action verb`, descriptionHasAction, description);

    const referenceInMeta = /reference|assumption/i.test(title + ' ' + description);
    record(`${product.sku} title and description carry no design vocabulary`, !referenceInMeta, title);

    // The /en-us edition is inch-first, so the visible chip text is the imperial rendition while
    // data-metric keeps the millimetre source.
    const imperialChip = decodeEntities(match(html, /data-metric="([^"]*)"/) || '');
    const imperialText = text(match(html, /<strong data-metric="[^"]*">([^<]*)<\/strong>/) || '');
    if (/in$/.test(imperialText) && dimensions) {
      imperialChecked += 1;
      const inchMatch = /\d+(?:\.\d+)?/g;
      const rawParts = (imperialText.match(inchMatch) || []);
      const twoDecimals = rawParts.every((raw) => decimalsOf(raw) === 2);
      const metricParts = metricNumbers(dimensions) || [];
      const imperialParts = imperialNumbers(imperialText) || [];
      const closeEnough = metricParts.length === imperialParts.length
        && metricParts.every((mm, index) => Math.abs(mm / 25.4 - imperialParts[index]) <= TOLERANCE_INCH);
      record(`${product.sku} inch conversion keeps two decimals`, twoDecimals, imperialText);
      record(`${product.sku} inch conversion matches the millimetre source`, closeEnough, JSON.stringify({ dimensions, imperialText }));
    }
    record(`${product.sku} metric chip equals the database value`, imperialChip === dimensions, JSON.stringify({ imperialChip, dimensions }));
  }

  // ---------------------------------------------------------------- language checks
  // Only visible text counts: query strings and form values must keep the stored key so the
  // filter keeps working, and a German reader never sees the English label.
  const de = await get('/de/products');
  const deText = text(de.body);
  record('DE listing has no English series label', !/1200 Series|1700 Series|6600 Series|7200 Series|7300 Series|7600 Series|9000 Series|Engineering Hardware/.test(deText), 'English series label visible on DE');
  record('DE listing has no "7 Serie"', !/7\s*Serie/i.test(deText), '7 Serie visible on DE');

  const it = await get('/it/products');
  const itText = text(it.body);
  record('IT listing has no "Engineering Hardware"', !/Engineering Hardware/.test(itText), 'Engineering Hardware visible on IT');

  // Product pages carry series names in the structured data and in the inquiry summary, so the
  // language check has to reach a product page as well as the listing.
  const sampleSlug = products[0] ? products[0].slug : 'robe-hook-ol-1204';
  const deProduct = await get('/de/products/' + sampleSlug);
  record('DE product page has no English series label', !/1200 Series|1700 Series|6600 Series|7200 Series|7300 Series|7600 Series|9000 Series|Engineering Hardware/.test(deProduct.body), 'English series label on DE product page');
  const itProduct = await get('/it/products/' + sampleSlug);
  record('IT product page has no "Engineering Hardware"', !/Engineering Hardware/.test(itProduct.body), 'Engineering Hardware on IT product page');

  const deHome = await get('/de');
  record('DE switcher shows Deutsch', /Deutsch/.test(deHome.body), 'no Deutsch label');
  record('DE page has no English language label', !/>\s*English\s*</.test(deHome.body), 'English label on DE');
  const itHome = await get('/it');
  record('IT switcher shows Italiano', /Italiano/.test(itHome.body), 'no Italiano label');

  // ---------------------------------------------------------------- forbidden strings
  const contact = await get('/en-us/contact');
  record('contact page publishes a full address', !/to be confirmed/i.test(contact.body), '"to be confirmed" on contact');
  record('contact page carries PostalAddress data', /"PostalAddress"/.test(contact.body) || /PostalAddress/.test(contact.body), 'no PostalAddress');

  const pagesToScan = ['/en-us', '/en-us/products', '/en-us/products/' + (products[0] ? products[0].slug : ''), '/en-us/contact', '/en-us/resources', '/de', '/it'];
  for (const pagePath of pagesToScan) {
    const page = await get(pagePath);
    record(`${pagePath} has no forbidden finish label`, !/cannon fodder/i.test(page.body), 'Cannon fodder found');
    record(`${pagePath} has no 3D vocabulary`, !/\b3D\b|three\.js|\.glb\b|exploded view/i.test(page.body), '3D vocabulary found');
  }

  // ---------------------------------------------------------------- report
  const summary = {
    base: BASE,
    checkedSkus: sample.length,
    dimensionComparisons: dimensionChecked,
    imperialComparisons: imperialChecked,
    checks: checks.length,
    passed: checks.filter((check) => check.ok).length,
    failed: failures.length,
    failures,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      if (!check.ok) console.log(`FAIL  ${check.name}  ${JSON.stringify(check.detail)}`);
    }
    console.log(`checked ${summary.checks} assertions across ${summary.checkedSkus} SKUs: ${summary.passed} passed, ${summary.failed} failed`);
  }
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

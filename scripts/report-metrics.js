'use strict';

/**
 * Single source of truth for every number that appears in the report.
 *
 * The report text quotes this file; nothing is typed by hand. Run it after the site, the image
 * pipeline and the colour crawl have finished, then diff the output before and after a change.
 *
 * Usage: node scripts/report-metrics.js [--out ../deliverables/01_Report/metrics.json]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.resolve(ROOT, '..', 'deliverables', '01_Report', 'metrics.json');
const BASE = process.env.METRICS_BASE || 'http://127.0.0.1:4174';

function bytesOf(dir) {
  let total = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = bytesOf(full);
      total += nested.bytes;
      files += nested.files;
    } else {
      total += fs.statSync(full).size;
      files += 1;
    }
  }
  return { files, bytes: total };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

async function pageWeight(pathname) {
  try {
    const res = await fetch(BASE + pathname);
    const body = await res.text();
    return { status: res.status, htmlBytes: Buffer.byteLength(body, 'utf8'), htmlKB: Number((Buffer.byteLength(body, 'utf8') / 1024).toFixed(1)) };
  } catch (error) {
    return { status: 0, htmlBytes: 0, htmlKB: 0, error: error.message };
  }
}

function count(db, sql, ...params) {
  try { return db.prepare(sql).get(...params).c; } catch (_) { return null; }
}

function rows(db, sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch (_) { return []; }
}

async function main() {
  const outArg = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : DEFAULT_OUT;
  const outPath = path.resolve(ROOT, outArg);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'storage', 'olang.sqlite'), { readOnly: true });

  const manifest = readJson(path.join(ROOT, 'public', 'images', 'products', 'official', '_manifest.json'));
  const colorManifest = readJson(path.resolve(ROOT, '..', 'research', 'original_colors_manifest.json'));

  const products = count(db, 'SELECT COUNT(*) c FROM products WHERE published = 1');
  const unpublished = count(db, 'SELECT COUNT(*) c FROM products WHERE published = 0');
  const categories = count(db, 'SELECT COUNT(*) c FROM categories WHERE published = 1');
  const series = count(db, "SELECT COUNT(DISTINCT series) c FROM products WHERE published = 1 AND series IS NOT NULL AND TRIM(series) <> ''");
  const finishes = count(db, 'SELECT COUNT(*) c FROM official_colors');

  const attrByStatus = rows(db, 'SELECT status, COUNT(*) c FROM product_attributes GROUP BY status ORDER BY c DESC');
  const attributeTotal = attrByStatus.reduce((sum, row) => sum + row.c, 0);

  const translationByLocale = rows(db, 'SELECT locale, COUNT(*) c FROM product_translations GROUP BY locale ORDER BY locale');
  const translationOrphans = count(db, `
    SELECT COUNT(*) c FROM product_translations t
    LEFT JOIN products p ON p.id = t.product_id WHERE p.id IS NULL`);

  const assetsByKind = rows(db, 'SELECT kind, COUNT(*) c FROM image_assets GROUP BY kind ORDER BY c DESC');
  const assetsBySource = rows(db, 'SELECT source_type, COUNT(*) c FROM image_assets GROUP BY source_type ORDER BY c DESC');
  const assetTotal = assetsByKind.reduce((sum, row) => sum + row.c, 0);
  const assetWithGeometry = count(db, 'SELECT COUNT(*) c FROM image_assets WHERE natural_width IS NOT NULL AND aspect_ratio IS NOT NULL');
  const companyImages = count(db, "SELECT COUNT(*) c FROM image_assets WHERE path LIKE '/images/company/%'");
  const projectImages = count(db, "SELECT COUNT(*) c FROM image_assets WHERE path LIKE '/images/projects/%'");
  const sceneImages = count(db, "SELECT COUNT(*) c FROM image_assets WHERE kind IN ('scene','category_scene')");

  // Per-market configuration: the evidence that each edition answers a different buyer.
  const marketSettings = require('../src/services/market-config');
  const markets = marketSettings.allMarketSettings(db, 'en').map((row) => ({
    code: row.code,
    title: row.title,
    units: row.unitsLabel || row.unitSystem,
    currency: row.currencyCode,
    terms: row.terms,
    compliance: row.compliance,
    buyingContext: row.buyingContext,
    factCount: (row.facts || []).length,
    noteCount: (row.notes || []).length,
  }));

  // Behaviour insights: the event table turned into numbers a team can act on.
  const eventMap = new Map(rows(db, 'SELECT event_name, COUNT(*) c FROM analytics_events GROUP BY event_name').map((r) => [r.event_name, r.c]));
  const sessions = count(db, 'SELECT COUNT(DISTINCT session_id) c FROM analytics_events');
  const insight = (name) => Number(eventMap.get(name) || 0);
  const insights = {
    sessions,
    productViews: insight('product_view'),
    unitSwitches: insight('unit_switch'),
    finishSelects: insight('finish_select'),
    galleryViews: insight('gallery_view'),
    compares: insight('product_compare'),
    addToInquiry: insight('add_to_inquiry'),
    formStarts: insight('inquiry_form_start'),
    formSubmits: insight('inquiry_form_submit'),
    catalogueDownloads: insight('catalogue_download'),
    whatsappClicks: insight('whatsapp_click'),
    marketSwitches: insight('market_switch'),
    languageSwitches: insight('language_switch'),
    unitSwitchPerProductView: Number(((insight('unit_switch') / Math.max(1, insight('product_view'))) * 100).toFixed(1)),
    finishSelectPerProductView: Number(((insight('finish_select') / Math.max(1, insight('product_view'))) * 100).toFixed(1)),
    skusPerSession: Number((insight('product_view') / Math.max(1, sessions)).toFixed(2)),
  };

  const documents = count(db, 'SELECT COUNT(*) c FROM documents');
  const documentsWithFile = count(db, "SELECT COUNT(*) c FROM documents WHERE file_path IS NOT NULL AND file_path <> ''");
  const documentStatus = rows(db, 'SELECT status, COUNT(*) c FROM documents GROUP BY status');

  const analyticsTotal = count(db, 'SELECT COUNT(*) c FROM analytics_events');
  const analyticsNames = count(db, 'SELECT COUNT(DISTINCT event_name) c FROM analytics_events');
  const analyticsByEvent = rows(db, 'SELECT event_name, COUNT(*) c FROM analytics_events GROUP BY event_name ORDER BY c DESC');
  const inquiries = count(db, 'SELECT COUNT(*) c FROM inquiries');
  const inquiriesTest = count(db, 'SELECT COUNT(*) c FROM inquiries WHERE is_test = 1');
  const assistantQueries = count(db, 'SELECT COUNT(*) c FROM assistant_queries');
  const caseStudies = count(db, 'SELECT COUNT(*) c FROM case_studies');

  const colorRows = colorManifest ? colorManifest.items.reduce((sum, item) => sum + item.colors.length, 0) : null;
  const colorPhotoRows = colorManifest ? colorManifest.items.reduce((sum, item) => sum + item.colors.filter((color) => color.status === 'photograph').length, 0) : null;
  const skuWithColors = colorManifest ? colorManifest.items.filter((item) => item.colors.length > 0).length : null;
  const skuWithPhoto = colorManifest ? colorManifest.items.filter((item) => item.colors.some((color) => color.status === 'photograph')).length : null;
  const skuWithAllPhotos = colorManifest ? colorManifest.items.filter((item) => item.colors.length > 0 && item.colors.every((color) => color.status === 'photograph')).length : null;
  const skuSwatchOnly = colorManifest ? colorManifest.items.filter((item) => item.colors.length > 0 && item.colors.every((color) => color.status !== 'photograph')).length : null;

  const cardDir = bytesOf(path.join(ROOT, 'public', 'images', 'products', 'official', 'cards'));
  const responsiveDir = bytesOf(path.join(ROOT, 'public', 'images', 'products', 'official', 'responsive'));
  const modelsDir = path.join(ROOT, 'public', 'models');
  const threeDir = path.join(ROOT, 'public', 'vendor', 'three');
  const catalogueFile = path.join(ROOT, 'public', 'downloads', 'olang-catalogue-2026.pdf');

  const uniquePhotos = new Set(
    rows(db, 'SELECT DISTINCT local_path FROM product_color_images').map((row) => row.local_path),
  ).size;

  const metrics = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    catalogue: {
      products,
      unpublished,
      categories,
      series,
      finishes,
    },
    attributes: {
      total: attributeTotal,
      byStatus: attrByStatus,
    },
    translations: {
      byLocale: translationByLocale,
      orphans: translationOrphans,
    },
    images: {
      registered: assetTotal,
      withGeometry: assetWithGeometry,
      byKind: assetsByKind,
      bySource: assetsBySource,
      companyImages,
      projectImages,
      sceneImages,
      cardFiles: cardDir.files,
      cardBytes: cardDir.bytes,
      responsiveFiles: responsiveDir.files,
      responsiveBytes: responsiveDir.bytes,
      manifestSkus: manifest ? manifest.items.length : null,
      manifestDistorted: manifest ? manifest.counts.distorted : null,
      uniqueColourPhotographs: uniquePhotos,
    },
    colours: {
      skus: colorManifest ? colorManifest.items.length : null,
      finishRows: colorRows,
      finishRowsWithPhoto: colorPhotoRows,
      skusWithFinishNames: skuWithColors,
      skusWithAnyPhoto: skuWithPhoto,
      skusWithAllPhotos: skuWithAllPhotos,
      skusSwatchOnly: skuSwatchOnly,
      photoVerification: colorManifest ? colorManifest.photoVerification : null,
      clickTest: colorManifest && colorManifest.clickTest ? {
        sampled: colorManifest.clickTest.results.length,
        swatchesInLiveDom: colorManifest.clickTest.results.map((row) => row.swatch_count_in_dom),
      } : null,
    },
    retiredThreeD: {
      modelsDirectoryExists: fs.existsSync(modelsDir),
      modelsDirectoryBytes: fs.existsSync(modelsDir) ? bytesOf(modelsDir).bytes : 0,
      threeVendorExists: fs.existsSync(threeDir),
      modelSpecRows: count(db, "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='product_model_specs'"),
    },
    documents: {
      total: documents,
      withFile: documentsWithFile,
      byStatus: documentStatus,
    },
    analytics: {
      events: analyticsTotal,
      distinctEventNames: analyticsNames,
      byEvent: analyticsByEvent,
    },
    inquiries: {
      total: inquiries,
      testRecords: inquiriesTest,
    },
    assistant: { queries: assistantQueries },
    markets,
    insights,
    caseStudies,
    cataloguePdf: fs.existsSync(catalogueFile) ? {
      path: '/downloads/olang-catalogue-2026.pdf',
      bytes: fs.statSync(catalogueFile).size,
      megabytes: Number((fs.statSync(catalogueFile).size / (1024 * 1024)).toFixed(2)),
      pages: 14,
    } : null,
    pageWeight: {
      listing: await pageWeight('/en-us/products'),
      product: await pageWeight('/en-us/products/robe-hook-ol-1204'),
      home: await pageWeight('/en-us'),
    },
  };

  db.close();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2), 'utf8');
  console.log(`metrics written: ${path.relative(process.cwd(), outPath)}`);
  console.log(`products ${products} · categories ${categories} · series ${series} · finishes ${finishes}`);
  console.log(`attributes ${attributeTotal} · image assets ${assetTotal} (geometry ${assetWithGeometry}) · documents ${documents}`);
  console.log(`colours ${colorRows} rows, ${colorPhotoRows} with a photograph, across ${skuWithPhoto}/${skusOrDash(skuWithColors)} SKUs`);
  console.log(`analytics ${analyticsTotal} events / ${analyticsNames} names · inquiries ${inquiries} (test ${inquiriesTest})`);
  console.log(`listing HTML ${metrics.pageWeight.listing.htmlKB} KB · product HTML ${metrics.pageWeight.product.htmlKB} KB`);
}

function skusOrDash(value) {
  return value === null ? '?' : value;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };

'use strict';

/**
 * Crawl the public OLANG product pages and rebuild the finish vocabulary.
 *
 * What this script establishes, per SKU:
 *   - the page URL on en.olang.cn that the record points at;
 *   - the official finish labels exactly as the page prints them (`Chrome-plated`,
 *     `Cannon fodder`, `Chrome plating + matte black`, ...);
 *   - the swatch image for each label;
 *   - the number of gallery photographs the page publishes;
 *   - the local per-finish photograph, when one was captured, together with the CDN URL that
 *     was recorded at capture time, and whether that capture can be re-verified byte for byte.
 *
 * The raw record goes to research/original_colors_manifest.json; the colour names go into
 * official_colors / product_colors; the coverage report goes to
 * deliverables/05_QA/color-coverage.md.
 *
 * A label is *swatch-only* when no per-finish photograph can be attributed to it. That is the
 * only honest state for those rows: the page publishes a material chip, not a photograph.
 *
 * Usage:
 *   node scripts/crawl-original-colors.js                 # crawl + write DB + coverage report
 *   node scripts/crawl-original-colors.js --verify-photos # also re-download recorded CDN URLs
 *   node scripts/crawl-original-colors.js --limit 5       # quick sample
 *   node scripts/crawl-original-colors.js --click-test    # Playwright probe on a few pages
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const RESEARCH_DIR = path.resolve(ROOT, '..', 'research');
const MANIFEST_PATH = path.join(RESEARCH_DIR, 'original_colors_manifest.json');
const COVERAGE_PATH = path.resolve(ROOT, '..', 'deliverables', '05_QA', 'color-coverage.md');

const SITEMAP_URL = 'https://en.olang.cn/sitemap.xml';
const ORIGIN = 'https://en.olang.cn';
const USER_AGENT = 'OLANG-QA-Crawler/1.0 (+local audit; contact master@olang.cn)';
const CONCURRENCY = 4;
const PAGE_TIMEOUT_MS = 30000;

const { displayFinish, FINISH_LABELS } = require('../src/i18n/glossary');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en',
        ...(referer ? { referer } : {}),
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, status: res.status, body: '' };
    return { ok: true, status: res.status, body: await res.text() };
  } catch (error) {
    return { ok: false, status: 0, body: '', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url, referer) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, referer: referer || ORIGIN } });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function listProductPages() {
  const sitemap = await fetchText(SITEMAP_URL);
  if (!sitemap.ok) throw new Error(`sitemap unreachable: ${sitemap.status}`);
  const locs = [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const productPages = locs.filter((url) => /\/ProductDetail\/\d+\.html$/.test(url));
  return [...new Set(productPages)];
}

function parsePage(html, pageUrl) {
  const skuMatch = /<p class="e_text-31 s_title">\s*([A-Za-z0-9-]+)\s*<\/p>/.exec(html);
  const nameMatch = /<h1 class="e_h1-3 s_subtitle">\s*([^<]+?)\s*<\/h1>/.exec(html);

  const swatchBlock = /<ul[^>]*p_valueUl[\s\S]*?<\/ul>/.exec(html);
  const colors = [];
  if (swatchBlock) {
    const items = [...swatchBlock[0].matchAll(/<li class="itemValue[^"]*"[\s\S]*?<\/li>/g)];
    for (const item of items) {
      const labelMatch = /<span class="p_imgName">\s*([^<]+?)\s*<\/span>/.exec(item[0]);
      // The swatch is published through the lazy attribute; `src` only holds a spacer.
      const lazyMatch = /<img[^>]*\blazy="(https?:\/\/[^"]+\.(?:png|jpg|jpeg|webp))"/i.exec(item[0]);
      if (!labelMatch) continue;
      const officialLabel = labelMatch[1].trim();
      colors.push({
        color_label_raw: officialLabel,
        official_label: officialLabel,
        color_slug: slugify(displayFinish(officialLabel)),
        display_label: displayFinish(officialLabel),
        swatch_url: lazyMatch ? lazyMatch[1] : null,
      });
    }
  }

  const gallery = [...html.matchAll(/<img\s+src="\/npublic\/img\/s\.png"\s+lazy="(https:\/\/omo-oss-image[^"]+\.(?:jpg|jpeg|png))"[^>]*alt="[^"]*"/g)]
    .map((m) => m[1]);
  const galleryUnique = [...new Set(gallery)];

  return {
    page_url: pageUrl,
    sku: skuMatch ? skuMatch[1].trim() : null,
    product_name: nameMatch ? nameMatch[1].trim() : null,
    colors,
    gallery_images: galleryUnique,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function localPathToAbs(publicPath) {
  return path.join(ROOT, 'public', String(publicPath || '').replace(/^\/+/, ''));
}

/**
 * Rebuild the per-SKU colour registry from the crawl, then attach whatever per-finish
 * photographs the earlier capture left on disk, applying the uniqueness rule.
 */
function syncDatabase(db, records) {
  const stats = {
    colorsUpserted: 0,
    productColorsRebuilt: 0,
    photosDistinct: 0,
    photosSwatchOnly: 0,
    photoVerified: 0,
    photoUnverified: 0,
    skusWithoutColors: [],
    pageMismatch: [],
  };

  const productRows = db.prepare('SELECT id, sku, source_url, image_path FROM products WHERE published = 1').all();
  const bySku = new Map(productRows.map((row) => [row.sku, row]));
  const now = new Date().toISOString();

  const insertColor = db.prepare(`
    INSERT INTO official_colors (official_label, display_label, kind, chip_path, swatch_url, note)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(official_label) DO UPDATE SET
      display_label = excluded.display_label,
      kind = excluded.kind,
      swatch_url = excluded.swatch_url,
      note = excluded.note
  `);
  const findColor = db.prepare('SELECT id FROM official_colors WHERE official_label = ?');
  const clearProductColors = db.prepare('DELETE FROM product_colors WHERE product_id = ?');
  const insertProductColor = db.prepare('INSERT OR REPLACE INTO product_colors (product_id, color_id, sort_order) VALUES (?,?,?)');
  const insertColorImage = db.prepare(`
    INSERT INTO product_color_images (product_id, sku, official_label, display_label, local_path, source_image_url, source_page, captured_at)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  const clearColorImages = db.prepare('DELETE FROM product_color_images WHERE product_id = ?');
  const clearColorImageByPath = db.prepare('DELETE FROM product_color_images WHERE local_path = ?');

  const finishPhotos = db.prepare(`
    SELECT product_id, finish_code, official_label, file_path, source_url, is_shared
    FROM product_finish_photo
  `).all();
  const photosByProduct = new Map();
  for (const row of finishPhotos) {
    if (!photosByProduct.has(row.product_id)) photosByProduct.set(row.product_id, []);
    photosByProduct.get(row.product_id).push(row);
  }

  for (const record of records) {
    const product = bySku.get(record.sku);
    if (!product) continue;
    if (record.page_url && product.source_url && product.source_url !== record.page_url) {
      stats.pageMismatch.push({ sku: record.sku, db: product.source_url, page: record.page_url });
    }

    // 1. Finish vocabulary
    clearProductColors.run(product.id);
    const seen = new Set();
    record.colors.forEach((color, index) => {
      if (seen.has(color.official_label)) return;
      seen.add(color.official_label);
      const note = FINISH_LABELS[color.color_label_raw] ? FINISH_LABELS[color.color_label_raw].note : '';
      insertColor.run(
        color.color_label_raw,
        color.display_label,
        /\+/.test(color.color_label_raw) ? 'two_tone' : 'metal',
        null,
        color.swatch_url,
        note,
      );
      stats.colorsUpserted += 1;
      const row = findColor.get(color.color_label_raw);
      if (row) {
        insertProductColor.run(product.id, row.id, index);
        stats.productColorsRebuilt += 1;
      }
    });
    if (!record.colors.length) stats.skusWithoutColors.push(record.sku);

    // 2. Per-finish photographs: keep only files that are unique within the SKU and differ
    //    from the main product photograph. Match on the finish slug, because the archived
    //    registry stores both the page label (Chrome-plated) and the display label (Chrome).
    clearColorImages.run(product.id);
    const photos = photosByProduct.get(product.id) || [];
    const hashes = new Map();
    for (const photo of photos) {
      const abs = localPathToAbs(photo.file_path);
      if (!fs.existsSync(abs)) { hashes.set(photo.finish_code, null); continue; }
      hashes.set(photo.finish_code, md5(fs.readFileSync(abs)));
    }
    const mainAbs = product.image_path ? localPathToAbs('/' + String(product.image_path).replace(/^\/+/, '')) : null;
    const mainHash = mainAbs && fs.existsSync(mainAbs) ? md5(fs.readFileSync(mainAbs)) : null;
    const hashCounts = new Map();
    for (const hash of hashes.values()) {
      if (!hash) continue;
      hashCounts.set(hash, (hashCounts.get(hash) || 0) + 1);
    }

    const photoBySlug = new Map();
    for (const photo of photos) {
      const hash = hashes.get(photo.finish_code);
      const isDistinct = Boolean(hash) && hashCounts.get(hash) === 1 && hash !== mainHash;
      if (!isDistinct) continue;
      photoBySlug.set(slugify(photo.finish_code), { ...photo, hash });
    }
    for (const color of record.colors) {
      const match = photoBySlug.get(color.color_slug);
      if (match) {
        stats.photosDistinct += 1;
        clearColorImageByPath.run(match.file_path);
        insertColorImage.run(
          product.id,
          record.sku,
          color.color_label_raw,
          color.display_label,
          match.file_path,
          match.source_url || '',
          record.page_url,
          now,
        );
      } else {
        stats.photosSwatchOnly += 1;
      }
    }
  }

  return stats;
}

async function verifyPhotos(records) {
  // sharp is optional here: the audit still works without it, it just reports byte equality only.
  let sharp = null;
  try { sharp = require('sharp'); } catch (_) { /* keep null */ }

  async function fingerprint(buffer) {
    if (!sharp) return null;
    const raw = await sharp(buffer).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
    return raw;
  }

  function meanAbsDiff(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  let identical = 0;
  let matchingRendition = 0;
  let differentContent = 0;
  let unreachable = 0;
  let skipped = 0;

  for (const record of records) {
    for (const color of record.colors) {
      if (!color.local_path || !color.photo_url) { skipped += 1; continue; }
      const abs = localPathToAbs(color.local_path);
      if (!fs.existsSync(abs)) { skipped += 1; continue; }
      const localBuffer = fs.readFileSync(abs);
      const remote = await fetchBuffer(color.photo_url, record.page_url);
      if (!remote) { color.photo_status = 'unreachable'; unreachable += 1; continue; }

      if (md5(remote) === md5(localBuffer)) {
        color.photo_status = 'byte_identical';
        identical += 1;
        continue;
      }
      const localPrint = await fingerprint(localBuffer);
      const remotePrint = await fingerprint(remote);
      const diff = meanAbsDiff(localPrint, remotePrint);
      if (diff !== null && diff <= 2) {
        color.photo_status = 'same_photograph_different_encoding';
        color.photo_match_diff = Number(diff.toFixed(3));
        matchingRendition += 1;
      } else {
        color.photo_status = 'different_content';
        if (diff !== null) color.photo_match_diff = Number(diff.toFixed(3));
        differentContent += 1;
      }
    }
  }

  return { identical, matchingRendition, differentContent, unreachable, skipped };
}

async function clickTest(records) {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch (_) {
    return { supported: false, reason: 'playwright-core not installed' };
  }
  const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
    .find((candidate) => fs.existsSync(candidate));
  if (!candidates) return { supported: false, reason: 'no Chromium-based browser found' };

  const browser = await chromium.launch({ executablePath: candidates, headless: true });
  const results = [];
  try {
    const sample = records.slice(0, 5);
    for (const record of sample) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      try {
        await page.goto(record.page_url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        await page.waitForTimeout(2500);
        const probe = await page.evaluate(() => {
          const list = [...document.querySelectorAll('.p_valueUl li.itemValue')];
          const mainImage = document.querySelector('.p_bigImg img, .e_image img, [class*="bigImg"] img');
          return {
            swatchCount: list.length,
            labels: list.map((li) => (li.querySelector('.p_imgName') || {}).textContent || '').map((s) => s.trim()),
            mainImageAlt: mainImage ? mainImage.alt : null,
          };
        });
        let changed = false;
        if (probe.swatchCount > 0) {
          const before = await page.evaluate(() => (document.querySelector('.p_bigImg img') || {}).src || '');
          await page.locator('.p_valueUl li.itemValue').first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(3000);
          const after = await page.evaluate(() => (document.querySelector('.p_bigImg img') || {}).src || '');
          changed = Boolean(before && after && before !== after);
        }
        results.push({
          sku: record.sku,
          page_url: record.page_url,
          swatch_count_in_dom: probe.swatchCount,
          server_rendered_colors: record.colors.length,
          main_image_changed_on_click: changed,
          note: probe.swatchCount === 0
            ? 'The live DOM exposes no finish swatch list, so a click cannot change the main photograph on this page.'
            : '',
        });
      } catch (error) {
        results.push({ sku: record.sku, page_url: record.page_url, error: error.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { supported: true, results };
}

function buildCoverageReport(records, stats, meta) {
  const totalSkus = records.length;
  const withColors = records.filter((record) => record.colors.length > 0).length;
  const withoutColors = records.filter((record) => record.colors.length === 0);
  const withAnyPhoto = records.filter((record) => record.colors.some((color) => color.local_path)).length;
  const withAllPhotos = records.filter((record) => record.colors.length > 0 && record.colors.every((color) => color.local_path)).length;
  const swatchOnlySkus = records.filter((record) => record.colors.length > 0 && record.colors.every((color) => !color.local_path)).length;
  const colorRows = records.reduce((sum, record) => sum + record.colors.length, 0);
  const photoRows = records.reduce((sum, record) => sum + record.colors.filter((color) => color.local_path).length, 0);
  const swatchOnlyRows = colorRows - photoRows;

  const lines = [];
  lines.push('# Colour coverage — official OLANG finishes');
  lines.push('');
  lines.push(`Generated ${meta.generatedAt} by \`platform/scripts/crawl-original-colors.js\` against ${ORIGIN}.`);
  lines.push('Source: the `p_valueUl` finish list on each public product page, plus the per-finish photographs captured from the same pages.');
  lines.push('');
  lines.push('| Measure | Count | Denominator |');
  lines.push('| --- | --- | --- |');
  lines.push(`| SKUs crawled | ${totalSkus} | 123 published SKUs |`);
  lines.push(`| SKUs with at least one official finish name | ${withColors} | ${totalSkus} |`);
  lines.push(`| SKUs with at least one per-finish photograph | ${withAnyPhoto} | ${totalSkus} |`);
  lines.push(`| SKUs with a photograph for every listed finish | ${withAllPhotos} | ${totalSkus} |`);
  lines.push(`| SKUs with swatches only (no per-finish photograph) | ${swatchOnlySkus} | ${totalSkus} |`);
  lines.push(`| SKUs where the page publishes no finish field | ${withoutColors.length} | ${totalSkus} |`);
  lines.push(`| Finish rows in total | ${colorRows} | — |`);
  lines.push(`| Finish rows with a photograph | ${photoRows} | ${colorRows} |`);
  lines.push(`| Finish rows shown as a swatch only | ${swatchOnlyRows} | ${colorRows} |`);
  lines.push('');
  lines.push('## How a finish row is classified');
  lines.push('');
  lines.push('A finish gets a photograph on the page only when all three conditions hold: the file exists in `public/images/products/official/`, the file is byte-unique inside that SKU, and it differs from the main product photograph. A finish whose only available image duplicates another finish of the same SKU is shown as a material chip, and the page offers `Finish sample on request` instead of a misleading photograph.');
  lines.push('');
  if (withoutColors.length) {
    lines.push('## SKUs where the original page publishes no finish field');
    lines.push('');
    lines.push('The report states the same fact for these SKUs: the original site does not publish a colour option.');
    lines.push('');
    for (const record of withoutColors) lines.push(`- ${record.sku || '(no SKU parsed)'} — ${record.page_url}`);
    lines.push('');
  }
  if (meta.clickTest && meta.clickTest.supported) {
    lines.push('## Click test on the original page');
    lines.push('');
    lines.push('| SKU | Swatches in live DOM | Server-rendered labels | Main photograph changed on click |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of meta.clickTest.results) {
      lines.push(`| ${row.sku} | ${row.swatch_count_in_dom ?? 'n/a'} | ${row.server_rendered_colors ?? 'n/a'} | ${row.main_image_changed_on_click === undefined ? 'n/a' : (row.main_image_changed_on_click ? 'yes' : 'no')} |`);
    }
    lines.push('');
    const note = meta.clickTest.results.find((row) => row.note);
    if (note) lines.push(`Observation: ${note.note}`);
    lines.push('');
  }
  if (meta.photoVerification) {
    lines.push('## Verification of the captured photographs');
    lines.push('');
    lines.push('Each recorded CDN URL was downloaded again and compared with the file the site serves.');
    lines.push('');
    lines.push(`- Byte-identical: ${meta.photoVerification.identical}`);
    lines.push(`- Same photograph, different encoding or rendition: ${meta.photoVerification.matchingRendition}`);
    lines.push(`- Different content: ${meta.photoVerification.differentContent}`);
    lines.push(`- Recorded URL no longer reachable: ${meta.photoVerification.unreachable}`);
    lines.push(`- No recorded image URL to check: ${meta.photoVerification.skipped}`);
    lines.push('');
  }
  lines.push('## Raw record');
  lines.push('');
  lines.push('`research/original_colors_manifest.json`');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
  const doVerify = argv.includes('--verify-photos');
  const doClick = argv.includes('--click-test');

  const { openDatabase, closeDatabase, transaction } = require('../src/db');

  console.log('sitemap…');
  let pages = await listProductPages();
  console.log(`product pages in sitemap: ${pages.length}`);
  if (limit) pages = pages.slice(0, limit);

  const fetched = await mapWithConcurrency(pages, CONCURRENCY, async (pageUrl) => {
    const res = await fetchText(pageUrl);
    if (!res.ok) return { page_url: pageUrl, error: `HTTP ${res.status}`, colors: [], gallery_images: [] };
    return parsePage(res.body, pageUrl);
  });

  const records = fetched
    .filter((record) => record && record.page_url)
    .sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));

  const unparsed = records.filter((record) => !record.sku);
  const parsed = records.filter((record) => record.sku);
  console.log(`parsed SKU on ${parsed.length} pages (${unparsed.length} without a SKU field)`);

  const db = openDatabase();
  let stats;
  try {
    stats = transaction(db, () => syncDatabase(db, parsed));
  } finally {
    closeDatabase(db);
  }
  console.log(`colours upserted: ${stats.colorsUpserted}, product colour rows: ${stats.productColorsRebuilt}`);
  console.log(`per-finish photographs kept: ${stats.photosDistinct}, rows marked swatch-only: ${stats.photosSwatchOnly}`);
  if (stats.pageMismatch.length) console.log(`source_url differs from the crawled page on ${stats.pageMismatch.length} rows`);

  // Attach the local photograph (if any) to each colour row so the manifest is self-contained.
  const db2 = openDatabase();
  try {
    const photoRows = db2.prepare('SELECT sku, official_label, display_label, local_path, source_image_url FROM product_color_images').all();
    const bySku = new Map();
    for (const row of photoRows) {
      if (!bySku.has(row.sku)) bySku.set(row.sku, new Map());
      bySku.get(row.sku).set(row.official_label, row);
      bySku.get(row.sku).set(row.display_label, row);
    }
    for (const record of parsed) {
      const map = bySku.get(record.sku) || new Map();
      for (const color of record.colors) {
        const photo = map.get(color.color_label_raw) || map.get(color.display_label);
        if (photo) {
          const imageUrl = /\.(png|jpe?g|webp)(\?|$)/i.test(String(photo.source_image_url || '')) ? photo.source_image_url : null;
          color.photo_local_path = photo.local_path;
          color.local_path = photo.local_path;
          color.photo_url = imageUrl;
          color.photo_page = photo.source_page || record.page_url;
          color.status = 'photograph';
        } else {
          color.photo_local_path = null;
          color.local_path = null;
          color.photo_url = null;
          color.status = 'swatch_only';
        }
      }
    }
  } finally {
    closeDatabase(db2);
  }

  const meta = { generatedAt: new Date().toISOString() };
  if (doClick) {
    console.log('click test on a 5-page sample…');
    meta.clickTest = await clickTest(parsed);
    if (!meta.clickTest.supported) console.log('click test unavailable: ' + meta.clickTest.reason);
  }
  if (doVerify) {
    console.log('re-downloading recorded photograph URLs…');
    meta.photoVerification = await verifyPhotos(parsed);
    console.log(JSON.stringify(meta.photoVerification));
  }

  const manifest = {
    generatedAt: meta.generatedAt,
    source: SITEMAP_URL,
    origin: ORIGIN,
    crawler: 'platform/scripts/crawl-original-colors.js',
    rule: {
      labelSource: 'p_valueUl li.itemValue > .p_imgName',
      swatchSource: 'p_valueUl li.itemValue img[lazy]',
      photoRule: 'a per-finish photograph is shown only when the file is unique inside the SKU and differs from the main photograph',
      forbiddenLabel: 'Cannon fodder is a machine translation of 枪灰 and is rendered as Gunmetal',
    },
    clickTest: meta.clickTest || null,
    photoVerification: meta.photoVerification || null,
    counts: {
      skus: parsed.length,
      finishRows: parsed.reduce((sum, record) => sum + record.colors.length, 0),
      skusWithoutFinishField: stats.skusWithoutColors.length,
    },
    items: parsed,
  };

  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('manifest: ' + path.relative(ROOT, MANIFEST_PATH));

  fs.mkdirSync(path.dirname(COVERAGE_PATH), { recursive: true });
  fs.writeFileSync(COVERAGE_PATH, buildCoverageReport(parsed, stats, meta), 'utf8');
  console.log('coverage: ' + path.relative(ROOT, COVERAGE_PATH));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { parsePage, listProductPages, buildCoverageReport };

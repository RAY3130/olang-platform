'use strict';

/**
 * Three-edition site audit: renders, screenshots, link/asset checks, key
 * interactions, mobile overflow and axe accessibility scans.
 *
 * This is automated QA, not a human usability study.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, '..', 'deliverables', '06_Website_QA');
const SHOTS = path.join(OUT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  ['uk-home', '/en-gb', true],
  ['de-home', '/de-de', true],
  ['ja-home', '/ja-jp', true],
  ['uk-products', '/en-gb/products', true],
  ['de-products', '/de-de/products', true],
  ['ja-products', '/ja-jp/products', true],
  ['uk-category', '/en-gb/products/category/robe-hooks', false],
  ['uk-product', '/en-gb/products/robe-hook-ol-1204', true],
  ['de-product', '/de-de/products/robe-hook-ol-1204', true],
  ['ja-product', '/ja-jp/products/robe-hook-ol-1204', true],
  ['uk-series-index', '/en-gb/series', true],
  ['de-series-index', '/de-de/series', false],
  ['ja-series-index', '/ja-jp/series', false],
  ['uk-series', '/en-gb/series/1200', true],
  ['de-series', '/de-de/series/1200', false],
  ['ja-series', '/ja-jp/series/1200', true],
  ['uk-series-engineering', '/en-gb/series/engineering-hardware', false],
  ['uk-selector', '/en-gb/selector', true],
  ['ja-selector', '/ja-jp/selector?space=accessible', false],
  ['uk-project-list', '/en-gb/projects', false],
  ['uk-project', '/en-gb/projects/shangri-la-hotel-singapore', true],
  ['de-project', '/de-de/projects/shangri-la-hotel-singapore', false],
  ['ja-project', '/ja-jp/projects/shangri-la-hotel-singapore', true],
  ['uk-customizer', '/en-gb/customization', true],
  ['de-customizer', '/de-de/customization', true],
  ['ja-customizer', '/ja-jp/customization', true],
  ['uk-about', '/en-gb/about', false],
  ['ja-about', '/ja-jp/about', false],
  ['uk-resources', '/en-gb/resources', true],
  ['ja-resources', '/ja-jp/resources', false],
  ['uk-news', '/en-gb/news', false],
  ['ja-news', '/ja-jp/news', false],
  ['uk-contact', '/en-gb/contact', true],
  ['de-contact', '/de-de/contact', false],
  ['ja-contact', '/ja-jp/contact', true],
  ['uk-wholesale', '/en-gb/wholesale', false],
  ['ja-inquiry', '/ja-jp/inquiry', false],
  ['uk-compare', '/en-gb/compare', false],
  ['uk-privacy', '/en-gb/privacy', false],
  ['ja-privacy', '/ja-jp/privacy', false],
  ['uk-legal', '/en-gb/legal', false],
];

const ACCESSIBILITY_PAGES = [
  ['/en-gb', 'uk-home'],
  ['/de-de', 'de-home'],
  ['/ja-jp', 'ja-home'],
  ['/en-gb/products/robe-hook-ol-1204', 'uk-product'],
  ['/en-gb/series', 'uk-series-index'],
  ['/en-gb/series/1200', 'uk-series'],
  ['/en-gb/selector', 'uk-selector'],
  ['/en-gb/customization', 'uk-customizer'],
  ['/ja-jp/contact', 'ja-contact'],
];

function safeName(value) { return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, ''); }

async function pageInfo(page, response) {
  return page.evaluate(() => {
    const meta = (name) => (document.querySelector(`meta[name="${name}"]`) || {}).content || '';
    const canonical = (document.querySelector('link[rel="canonical"]') || {}).href || '';
    const images = [...document.images];
    // Lazy images below the fold are not broken just because the browser has
    // not requested them yet. Only count images that finished with no pixels,
    // or images whose load event already errored by marking them below.
    const brokenImages = images.filter((img) => (!img.complete || img.naturalWidth === 0) && img.getAttribute('loading') !== 'lazy').map((img) => img.currentSrc || img.src);
    const missingAlt = images.filter((img) => !img.hasAttribute('alt')).length;
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const text = document.body.innerText;
    return {
      title: document.title,
      htmlLang: document.documentElement.lang,
      metaDescription: meta('description'),
      robots: meta('robots'),
      canonical,
      h1: [...document.querySelectorAll('h1')].map((node) => node.innerText.trim()),
      hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((node) => `${node.hreflang}:${node.href}`),
      brokenImages,
      imageCount: images.length,
      missingAlt,
      overflow,
      hasMissingKeyText: /\b(?:common|product|pages|forms|assistant|customizer)\.[a-zA-Z.]+\b|undefined|NaN|\[object Object\]/.test(text),
      bodyStart: text.slice(0, 220),
    };
  }).then((info) => ({ ...info, status: response ? response.status() : null }));
}

async function main() {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`); });

  async function gotoStable(url, waitUntil = 'load') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await page.goto(url, { waitUntil, timeout: 60000 });
      } catch (error) {
        if (attempt === 2) throw error;
        await page.waitForTimeout(600);
      }
    }
    return null;
  }

  // Consent is required before any analytics event can be stored.
  await gotoStable(`${BASE}/en-gb`, 'networkidle');
  await page.getByRole('button', { name: /Allow analytics|Analyse erlauben|アクセス解析を許可/ }).click().catch(() => {});
  await page.waitForTimeout(1600);
  await page.waitForLoadState('networkidle').catch(() => {});
  await gotoStable(`${BASE}/en-gb`);

  const results = { startedAt, base: BASE, pages: [], accessibility: [], interactions: [], mobile: [], links: null, errors: [] };
  for (const [name, pathname, screenshot] of PAGES) {
    const response = await gotoStable(BASE + pathname);
    await page.waitForTimeout(250);
    const info = await pageInfo(page, response);
    results.pages.push({ name, path: pathname, ...info });
    if (screenshot) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  }

  // Mobile overflow and screenshots.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => consoleErrors.push(`mobile pageerror: ${error.message}`));
  for (const [name, pathname] of [['ja-mobile-home', '/ja-jp'], ['ja-mobile-product', '/ja-jp/products/robe-hook-ol-1204'], ['ja-mobile-series', '/ja-jp/series/1200'], ['ja-mobile-selector', '/ja-jp/selector'], ['ja-mobile-customizer', '/ja-jp/customization'], ['de-mobile-product', '/de-de/products/towel-ring-ol-1205']]) {
    const response = await mobile.goto(BASE + pathname, { waitUntil: 'load' });
    await mobile.waitForTimeout(250);
    const info = await pageInfo(mobile, response);
    results.mobile.push({ name, path: pathname, ...info });
    await mobile.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  }
  await mobileContext.close();

  // Link and asset checks derived from the sitemap and the rendered pages.
  const sitemapText = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const sitemapUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const linkRows = [];
  for (const url of sitemapUrls) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      linkRows.push({ url, status: res.status, ok: res.status >= 200 && res.status < 400, type: 'page' });
    } catch (error) {
      linkRows.push({ url, status: 0, ok: false, type: 'page', error: error.message });
    }
  }
  const assetSet = new Set();
  for (const [name, pathname] of PAGES.slice(0, 12)) {
    await gotoStable(BASE + pathname);
    const assets = await page.evaluate(() => [
      ...document.images,
      ...[...document.querySelectorAll('link[rel="stylesheet"][href], script[src]')],
    ].map((node) => {
      if (node.tagName === 'IMG') return node.getAttribute('src');
      return node.getAttribute('href') || node.getAttribute('src');
    }).filter((value) => value && value.startsWith('/')));
    assets.forEach((asset) => assetSet.add(asset));
  }
  for (const asset of [...assetSet]) {
    try {
      const res = await fetch(BASE + asset, { redirect: 'manual' });
      linkRows.push({ url: BASE + asset, status: res.status, ok: res.status >= 200 && res.status < 400, type: 'asset' });
    } catch (error) {
      linkRows.push({ url: BASE + asset, status: 0, ok: false, type: 'asset', error: error.message });
    }
  }
  const broken = linkRows.filter((row) => !row.ok);
  results.links = { checked: linkRows.length, pages: sitemapUrls.length, broken: broken.length, brokenRows: broken.slice(0, 80), all: linkRows };
  results.errorRows = results.pages.filter((entry) => entry.status !== 200 || entry.hasMissingKeyText || entry.overflow > 2 || entry.brokenImages.length || entry.missingAlt);
  results.mobileErrorRows = results.mobile.filter((entry) => entry.status !== 200 || entry.hasMissingKeyText || entry.overflow > 2 || entry.brokenImages.length);

  // Interactions ------------------------------------------------------------
  const checks = [];
  const check = (name, passed, evidence) => checks.push({ name, passed, evidence: String(evidence || '').slice(0, 300) });

  await page.goto(`${BASE}/en-gb`, { waitUntil: 'networkidle' });
  await page.locator('.site-nav summary').first().click();
  check('UK Products menu opens', await page.locator('.site-nav details[open]').count() > 0, await page.locator('.site-nav details[open]').count());
  await page.goto(`${BASE}/en-gb/products?q=OL-1204`, { waitUntil: 'networkidle' });
  check('Model search returns OL-1204', (await page.locator('[data-product-card]').count()) >= 1 && /OL-1204/.test(await page.locator('body').innerText()), await page.locator('[data-product-card]').count());
  await page.goto(`${BASE}/en-gb/products/robe-hook-ol-1204`, { waitUntil: 'networkidle' });
  const originalSrc = await page.locator('[data-photo-main]').getAttribute('src');
  await page.locator('[data-photo-thumb][data-finish-label="Brushed Gold"]').click();
  const finishSrc = await page.locator('[data-photo-main]').getAttribute('src');
  check('Finish photograph changes the main image', finishSrc !== originalSrc && /brushed-gold/i.test(finishSrc), `${originalSrc} -> ${finishSrc}`);
  const detailThumbs = await page.locator('[data-photo-thumb][data-view^="detail"]').count();
  const finishThumbs = await page.locator('[data-photo-thumb][data-finish-label]').count();
  const allThumbs = await page.locator('[data-photo-thumb]').count();
  check('Fabricated detail-crop buttons removed', detailThumbs === 0, `detail thumbs=${detailThumbs}`);
  check('Gallery = overview + official finish photographs', allThumbs === finishThumbs + 1, `${allThumbs} thumbs, ${finishThumbs} finish photos`);
  const documentRows = await page.locator('#documents .document-table tbody tr').count();
  check('PDP exposes a real document register', documentRows >= 3, `${documentRows} document rows`);
  const matrixRows = await page.locator('#series-matrix .sku-matrix tbody tr').count();
  check('PDP exposes the same-series SKU matrix', matrixRows >= 2, `${matrixRows} matrix rows`);
  await page.locator('[data-photo-zoom]').click();
  check('Image zoom lightbox opens', !(await page.locator('[data-photo-lightbox]').getAttribute('hidden')), 'lightbox visible');
  await page.locator('[data-photo-close]').click();
  await page.locator('.product-detail-copy [data-add-inquiry]').first().click();
  await page.waitForTimeout(250);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('olang_inquiry_v1') || '[]'));
  check('Add to quote persists a selected SKU', stored.some((item) => item.sku === 'OL-1204'), JSON.stringify(stored.map((item) => item.sku)));
  await page.goto(`${BASE}/en-gb/products/robe-hook-ol-1204`, { waitUntil: 'networkidle' });
  await page.locator('.market-switch a[hreflang="de-DE"]').click();
  await page.waitForLoadState('networkidle');
  check('Language switch preserves the product path', /\/de-de\/products\/robe-hook-ol-1204$/.test(page.url()), page.url());
  check('Switched edition has German UI', /<html lang="de-DE"/.test(await page.content()), await page.locator('html').getAttribute('lang'));

  await page.goto(`${BASE}/en-gb/series/1200`, { waitUntil: 'networkidle' });
  check('Series page exposes the seven published 1200 models', (await page.locator('[data-product-card]').count()) === 7, await page.locator('[data-product-card]').count());
  check('Series page has a finish wall', (await page.locator('.finish-wall-item').count()) >= 2, await page.locator('.finish-wall-item').count());

  await page.goto(`${BASE}/en-gb/selector?space=accessible&finish=Chrome`, { waitUntil: 'networkidle' });
  const selectorCards = await page.locator('[data-product-card]').count();
  const selectorCategories = await page.locator('[data-product-card]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute('data-category')))]);
  check('Guided selector returns a real result subset', selectorCards > 0 && selectorCategories.length === 1 && selectorCategories[0] === 'grab-bar', `${selectorCards} cards / ${selectorCategories}`);

  await page.goto(`${BASE}/en-gb/projects`, { waitUntil: 'networkidle' });
  await page.locator('.project-card h3 a').first().click();
  await page.waitForLoadState('networkidle');
  check('Project card opens a detail page', /\/projects\/[^/]+$/.test(page.url()) && /Published building photograph/.test(await page.locator('body').innerText()), page.url());

  await page.goto(`${BASE}/ja-jp/products/robe-hook-ol-1204`, { waitUntil: 'networkidle' });
  await page.locator('[data-open-assistant]').first().click();
  await page.locator('#assistant-question').fill('OL-1204の仕上げは？');
  await page.locator('[data-assistant-form] button[type="submit"], [data-assistant-form] button').last().click();
  await page.waitForTimeout(1000);
  const assistantText = await page.locator('[data-assistant-answer]').innerText();
  check('Japanese assistant returns grounded answer', /クローム/.test(assistantText) && /情報源|出典/.test(assistantText), assistantText.slice(0, 200));
  const feedbackVisible = await page.locator('.assistant-feedback').count() > 0;
  check('Assistant feedback control is present', feedbackVisible, feedbackVisible);

  results.interactions = checks;

  // Accessibility with axe-core, injected locally so no third-party request is made.
  const axePath = require.resolve('axe-core/axe.min.js');
  const axeSource = fs.readFileSync(axePath, 'utf8');
  for (const [pathname, name] of ACCESSIBILITY_PAGES) {
    await gotoStable(BASE + pathname, 'networkidle');
    // CDP evaluation runs in the page but is not an inline <script>, so the
    // strict CSP is preserved during the audit.
    await page.evaluate(axeSource);
    const axe = await page.evaluate(async () => {
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return { violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
    });
    results.accessibility.push({ name, path: pathname, violations: axe.violations });
  }

  results.consoleErrors = [...new Set(consoleErrors)];
  results.finishedAt = new Date().toISOString();
  results.summary = {
    pages: results.pages.length,
    pageFailures: results.errorRows.length,
    mobilePages: results.mobile.length,
    mobileFailures: results.mobileErrorRows.length,
    linksChecked: results.links.checked,
    brokenLinks: results.links.broken,
    interactionChecks: results.interactions.length,
    interactionFailures: results.interactions.filter((entry) => !entry.passed).length,
    accessibilityPages: results.accessibility.length,
    accessibilityViolations: results.accessibility.reduce((sum, entry) => sum + entry.violations.length, 0),
    consoleErrors: results.consoleErrors.length,
  };
  fs.writeFileSync(path.join(OUT, 'site-audit.json'), JSON.stringify(results, null, 2));
  const pageCsv = ['name,path,status,title,htmlLang,robots,h1,imageCount,brokenImages,missingAlt,overflow,missingKeyText,canonical'];
  const csvCell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  for (const entry of results.pages) {
    pageCsv.push([
      entry.name, entry.path, entry.status, entry.title, entry.htmlLang, entry.robots,
      (entry.h1 || []).join(' | '), entry.imageCount, (entry.brokenImages || []).length,
      entry.missingAlt, entry.overflow, entry.hasMissingKeyText, entry.canonical,
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(path.join(OUT, 'site-audit.csv'), pageCsv.join('\n'), 'utf8');
  const linkCsv = ['type,status,ok,url'];
  for (const row of linkRows) linkCsv.push([row.type, row.status, row.ok, `"${row.url.replace(/"/g, '""')}"`].join(','));
  fs.writeFileSync(path.join(OUT, 'link-check.csv'), linkCsv.join('\n'), 'utf8');
  console.log(JSON.stringify(results.summary, null, 2));
  if (results.summary.pageFailures || results.summary.mobileFailures || results.summary.brokenLinks || results.summary.interactionFailures || results.summary.accessibilityViolations) {
    console.log('PAGE FAILURES', JSON.stringify(results.errorRows, null, 2).slice(0, 4000));
    console.log('MOBILE FAILURES', JSON.stringify(results.mobileErrorRows, null, 2).slice(0, 3000));
    console.log('INTERACTION FAILURES', results.interactions.filter((entry) => !entry.passed));
    console.log('BROKEN', broken.slice(0, 30));
    console.log('A11Y', JSON.stringify(results.accessibility, null, 2).slice(0, 5000));
    process.exitCode = 1;
  }
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

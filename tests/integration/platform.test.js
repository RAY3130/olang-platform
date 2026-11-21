'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'olang-platform-test-'));
process.env.DB_PATH = path.join(TEST_ROOT, 'test.sqlite');
process.env.UPLOAD_DIR = path.join(TEST_ROOT, 'uploads');
process.env.SITE_MODE = 'demo';
process.env.EMAIL_TRANSPORT = 'outbox';
process.env.SITE_URL = 'http://127.0.0.1:4174';
process.env.ADMIN_INITIAL_USERNAME = 'admin';
process.env.ADMIN_INITIAL_PASSWORD = 'TestAdmin!2026secure';
process.env.SESSION_COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';
process.env.OLANG_SECRET_DIR = TEST_ROOT;

const config = require('../../src/config');
const { openDatabase, closeDatabase } = require('../../src/db');
const { seedAll } = require('../../src/db/seed');
const { ensureSetting } = require('../../src/services/settings');
const { createApp } = require('../../src/app');

fs.mkdirSync(config.uploadDir, { recursive: true });
const db = openDatabase(config.dbPath);
const seedLog = { info() {}, warn() {}, error: console.error };
seedAll(db, seedLog);
ensureSetting(db, 'security.ip_hash_salt');
const app = createApp(db);
const server = app.listen(0, '127.0.0.1');
let base = '';

class Client {
  constructor() { this.cookies = new Map(); }
  store(response) {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  cookieHeader() { return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '); }
  async fetch(pathname, options = {}) {
    const headers = new Headers(options.headers || {});
    const cookie = this.cookieHeader();
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(`${base}${pathname}`, { ...options, headers, redirect: options.redirect || 'manual' });
    this.store(response);
    return response;
  }
  get(pathname) { return this.fetch(pathname); }
  async text(pathname) {
    const response = await this.get(pathname);
    return { response, text: await response.text() };
  }
  async submitForm(pathname, fields, attachments = []) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value == null ? '' : String(value));
    for (const file of attachments) {
      form.append('attachments', new Blob([file.buffer], { type: file.type }), file.name);
    }
    return this.fetch(pathname, { method: 'POST', headers: { Accept: 'application/json' }, body: form });
  }
}

function formTokens(html) {
  return {
    hiddenCsrf: (html.match(/name="_csrf" value="([^"]+)"/) || [])[1],
    stamp: (html.match(/name="form_stamp" value="([^"]+)"/) || [])[1],
  };
}

function minimalPdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function adminLogin(client) {
  const loginPage = await client.get('/admin/login');
  const html = await loginPage.text();
  const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  assert.ok(csrf, 'login CSRF token');
  const response = await client.fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'admin', password: 'TestAdmin!2026secure', next: '/admin' }).toString(),
  });
  assert.equal(response.status, 303);
  const dashboard = await client.get('/admin');
  const dashHtml = await dashboard.text();
  assert.equal(dashboard.status, 200);
  return (dashHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

test.before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => {
  server.close(() => {
    closeDatabase(db);
    try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch (_) {}
    resolve();
  });
}));

test('three editions render with correct language, links and no fabricated values', async () => {
  const client = new Client();
  const checks = [
    ['/en-gb', 'en-GB', 'United Kingdom', 'GBP'],
    ['/de-de', 'de-DE', 'Deutschland', 'EUR'],
    ['/ja-jp', 'ja-JP', '日本', 'JPY'],
  ];
  for (const [url, lang, name, currency] of checks) {
    const { response, text } = await client.text(url);
    assert.equal(response.status, 200, url);
    assert.match(text, new RegExp(`<html lang="${lang}"`), url);
    assert.match(text, /hreflang="en-GB"/);
    assert.match(text, /hreflang="de-DE"/);
    assert.match(text, /hreflang="ja-JP"/);
    assert.match(text, /x-default/);
    assert.match(text, /application\/ld\+json/);
    assert.match(text, /noindex,nofollow/);
    assert.match(text, new RegExp(name));
    assert.match(text, new RegExp(currency));
    assert.doesNotMatch(text, /H59|stainless steel 304|2\.20–4\.60|25–35 days|200 pcs per SKU/);
    assert.doesNotMatch(text, /\[object Promise\]|undefined|NaN/);
  }
  const legacy = await client.get('/en');
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get('location'), '/en-gb');
  const jap = await client.get('/ja');
  assert.equal(jap.status, 301);
  assert.equal(jap.headers.get('location'), '/ja-jp');
  const de = await client.get('/de');
  assert.equal(de.status, 301);
  assert.equal(de.headers.get('location'), '/de-de');
});

test('catalogue has 11 categories, 7 numbered series, category pages, filters and 12 product fields', async () => {
  const client = new Client();
  const { text: listHtml } = await client.text('/en-gb/products');
  assert.match(listHtml, /123/i);
  assert.match(listHtml, /Robe Hook/);
  assert.match(listHtml, /data-product-card/);
  const category = await client.get('/en-gb/products/category/towel-rings');
  const categoryHtml = await category.text();
  assert.equal(category.status, 200);
  assert.match(categoryHtml, /Towel Rings/);
  assert.match(categoryHtml, /OL-1205/);
  const filtered = await client.get('/en-gb/products?category=robe-hooks&finish=Chrome-plated');
  const filteredHtml = await filtered.text();
  assert.equal(filtered.status, 200);
  assert.match(filteredHtml, /OL-1204/);
  const skuSearch = await client.get('/ja-jp/products?q=OL-1204');
  assert.match(await skuSearch.text(), /OL-1204/);

  const product = await client.get('/ja-jp/products/robe-hook-ol-1204');
  const productHtml = await product.text();
  assert.equal(product.status, 200);
  assert.match(productHtml, /仕様/);
  assert.match(productHtml, /製品写真/);
  assert.match(productHtml, /クローム/);
  assert.match(productHtml, /data-spec-field=/);
  assert.match(productHtml, /55 × 55 × 70 mm/);
  assert.doesNotMatch(productHtml, /On request|FIELDS|Quality note|published/i);

  const colors = db.prepare('SELECT COUNT(*) c FROM product_colors').get().c;
  const images = db.prepare('SELECT COUNT(*) c FROM product_color_images').get().c;
  assert.ok(colors >= 120, `expected seeded finish associations, got ${colors}`);
  assert.ok(images >= 100, `expected seeded finish photographs, got ${images}`);
});

test('sitemap and robots expose three editions and case detail pages', async () => {
  const client = new Client();
  const sitemap = await client.get('/sitemap.xml');
  const xml = await sitemap.text();
  assert.equal(sitemap.status, 200);
  assert.match(xml, /\/en-gb\/products\/robe-hook-ol-1204/);
  assert.match(xml, /\/de-de\/products\/robe-hook-ol-1204/);
  assert.match(xml, /\/ja-jp\/products\/robe-hook-ol-1204/);
  assert.match(xml, /\/en-gb\/projects\/shangri-la-hotel-singapore/);
  assert.match(xml, /hreflang="ja-JP"/);
  assert.doesNotMatch(xml, /en-us\/products/);
  const robots = await client.get('/robots.txt');
  assert.match(await robots.text(), /Disallow:/);
});

test('presentation surfaces: no detail crops, image ratios, series pages and selector', async () => {
  const client = new Client();
  const product = await client.text('/en-gb/products/single-towel-bar-ol-1208');
  assert.equal(product.response.status, 200);
  assert.equal(product.text.includes('data-view="detail'), false);
  assert.equal((product.text.match(/data-gallery-count="(\d+)"/) || [])[1], '5');
  assert.match(product.text, /ratio-(1x1|4x3|3x2|2x1|3x4)/);
  assert.match(product.text, /Documents and downloads/);
  assert.match(product.text, /Compare models from the same series/);
  assert.match(product.text, /Installation and care/);

  const series = await client.text('/en-gb/series/1200');
  assert.equal(series.response.status, 200);
  assert.match(series.text, /1200 Series/);
  assert.ok((series.text.match(/data-product-card/g) || []).length >= 7);
  assert.match(series.text, /finishes in this series/);
  assert.match(series.text, /Request this series/);

  const germanSeries = await client.text('/de-de/series/1200');
  assert.equal(germanSeries.response.status, 200);
  assert.match(germanSeries.text, /1200-Serie/);
  assert.doesNotMatch(germanSeries.text, /published models|Request this series/);

  const selector = await client.text('/en-gb/selector?space=accessible&finish=Chrome');
  assert.equal(selector.response.status, 200);
  const selectorCategories = [...selector.text.matchAll(/data-product-card[^>]*data-category="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(selectorCategories.length > 0, 'selector has published results');
  assert.ok(selectorCategories.every((key) => key === 'grab-bar'), `unexpected selector categories: ${[...new Set(selectorCategories)]}`);

  const sitemap = await client.text('/sitemap.xml');
  assert.match(sitemap.text, /\/en-gb\/series\/1200/);
  assert.match(sitemap.text, /\/ja-jp\/series\/engineering-hardware/);
  assert.match(sitemap.text, /\/en-gb\/selector/);
});

test('project detail separates published facts and does not use an AI bathroom concept', async () => {
  const client = new Client();
  const { response, text } = await client.text('/en-gb/projects/shangri-la-hotel-singapore');
  assert.equal(response.status, 200);
  assert.match(text, /Published building photograph/);
  assert.match(text, /Bathroom and installation evidence/);
  assert.match(text, /Product scope/i);
  assert.doesNotMatch(text, /AI-generated|Illustrative interior concept|concept visual/i);
  assert.doesNotMatch(text, /actual installation photograph/i);
});

test('cookie consent is opt-in and analytics rejects unknown event names', async () => {
  const client = new Client();
  const page = await client.get('/en-gb');
  const html = await page.text();
  assert.match(html, /data-cookie-banner/);
  const { hiddenCsrf: csrf } = formTokens(html);
  const event = { event_id: 'evt_test_consent_1', event_name: 'page_view', session_id: 's_test', path: '/en-gb', market: 'en-gb', locale: 'en' };
  const before = await client.fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(before.status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM analytics_events').get().c, 0);
  const consent = await client.fetch('/api/consent', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ _csrf: csrf, market: 'en-gb', analytics: '1', return_to: '/en-gb' }).toString(),
  });
  assert.ok([200, 303].includes(consent.status));
  await client.fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...event, event_id: 'evt_test_consent_2' }) });
  assert.ok(db.prepare('SELECT COUNT(*) c FROM analytics_events').get().c >= 1);
  await client.fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...event, event_id: 'evt_test_bad_1', event_name: 'not_an_event' }) });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM analytics_events WHERE event_name = 'not_an_event'").get().c, 0);
});

test('customization request validates, stores products, buyer context and a private file', async () => {
  const client = new Client();
  const { text: html } = await client.text('/ja-jp/customization');
  const { hiddenCsrf, stamp } = formTokens(html);
  assert.ok(hiddenCsrf && stamp);
  await sleep(1300);
  const attachment = { name: 'qa-drawing.pdf', type: 'application/pdf', buffer: minimalPdf() };
  const response = await client.submitForm('/api/customization', {
    _csrf: hiddenCsrf,
    form_stamp: stamp,
    market: 'ja-jp',
    locale: 'ja',
    customer_type: 'hotel',
    request_type: 'sample',
    product_sku: 'OL-1204',
    qty_OL_1204: '80',
    finish_OL_1204: 'クローム',
    custom_finish: '1',
    finish_requirements: '客室用にクロームで統一したい。',
    custom_size: '1',
    target_dimensions: '既存の下地に合わせる。図面を添付。',
    project_country: '日本',
    project_type: 'hotel',
    project_scale: '80室',
    bathrooms_count: '80浴室',
    required_series: '1200シリーズ',
    contact_name: 'テスト購買担当',
    company: 'テストホテル',
    email: 'qa-hotel@example.com',
    country: '日本',
    consent: '1',
    message: 'E2Eテストのカスタマイズ相談です。',
  }, [attachment]);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.reference, /^OL-CUS-\d{6}-[A-F0-9]{6}$/);
  const row = db.prepare('SELECT * FROM customization_requests WHERE reference = ?').get(payload.reference);
  assert.equal(row.customer_type, 'hotel');
  assert.match(row.products_json, /OL-1204/);
  assert.match(row.buyer_context_json, /日本/);
  const file = db.prepare('SELECT * FROM customization_files WHERE request_id = ?').get(row.id);
  assert.equal(file.original_name, 'qa-drawing.pdf');
  assert.ok(fs.existsSync(path.join(config.uploadDir, file.stored_name)));

  const admin = new Client();
  await adminLogin(admin);
  const listed = await admin.get('/admin/customization');
  const listedHtml = await listed.text();
  assert.equal(listed.status, 200);
  assert.match(listedHtml, new RegExp(payload.reference));
  const detail = await admin.get(`/admin/customization/${row.id}`);
  assert.match(await detail.text(), /qa-hotel@example.com/);
  const csv = await admin.get('/admin/customization/export.csv');
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), new RegExp(payload.reference));
});

test('customizer supports five buyer types with different buyer-context fields', async () => {
  const client = new Client();
  const { text: html } = await client.text('/en-gb/customization');
  const { hiddenCsrf, stamp } = formTokens(html);
  await sleep(1300);
  const cases = [
    ['wholesale', { sales_countries: 'United Kingdom', oem_packaging: 'yes' }],
    ['hotel', { project_country: 'Japan', project_type: 'hotel', bathrooms_count: '75' }],
    ['oem', { brand_name: 'QA Private Label', target_material: 'brass' }],
    ['architect', { practice_name: 'QA Studio', architect_project_country: 'Germany' }],
    ['other', { business_type: 'Facility management', requirement_summary: 'Mixed accessories for offices' }],
  ];
  for (const [customerType, context] of cases) {
    const response = await client.submitForm('/api/customization', {
      _csrf: hiddenCsrf,
      form_stamp: stamp,
      market: 'en-gb',
      locale: 'en',
      customer_type: customerType,
      request_type: 'quote',
      product_sku: 'OL-1204',
      custom_material: '1',
      material_requirements: `QA ${customerType} material request`,
      contact_name: 'QA Buyer',
      email: `qa-${customerType}@example.com`,
      country: 'United Kingdom',
      consent: '1',
      ...context,
    });
    const bodyText = await response.text();
    assert.equal(response.status, 201, `${customerType}: ${bodyText}`);
    const payload = JSON.parse(bodyText);
    const row = db.prepare('SELECT * FROM customization_requests WHERE reference = ?').get(payload.reference);
    assert.equal(row.customer_type, customerType);
    const stored = JSON.parse(row.buyer_context_json);
    for (const [key, value] of Object.entries(context)) assert.equal(stored[key], value, `${customerType}.${key}`);
  }
});

test('inquiry submission persists a reference and private attachment', async () => {
  const client = new Client();
  const { text: html } = await client.text('/en-gb/wholesale');
  const { hiddenCsrf, stamp } = formTokens(html);
  assert.ok(hiddenCsrf && stamp);
  await sleep(1300);
  const response = await client.submitForm('/api/inquiries', {
    _csrf: hiddenCsrf,
    form_stamp: stamp,
    inquiry_type: 'wholesale',
    market: 'en-gb',
    source_path: '/en-gb/wholesale',
    return_to: '/en-gb/wholesale',
    name: 'Integration Buyer',
    company: 'Integration Imports',
    email: 'integration@example.com',
    country: 'United Kingdom',
    message: 'Integration test: confirm OL-1204 specification and packing.',
    consent: '1',
    'pick_OL-1204': '1',
    'qty_OL-1204': '250',
  }, [{ name: 'qa-inquiry.pdf', type: 'application/pdf', buffer: minimalPdf() }]);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.reference, /^OL-\d{6}-[A-Z0-9]{6}$/);
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE reference = ?').get(payload.reference);
  assert.ok(inquiry);
  assert.equal(inquiry.market, 'en-gb');
  const files = db.prepare('SELECT COUNT(*) c FROM inquiry_attachments WHERE inquiry_id = ?').get(inquiry.id).c;
  assert.equal(files, 1);
});

test('assistant answers in three languages with citations and refuses missing values', async () => {
  const ask = async (market, question) => {
    const response = await fetch(`${base}/api/assistant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ market, question }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const en = await ask('en-gb', 'What finishes does OL-1204 have?');
  assert.match(en.answer, /Chrome/);
  assert.ok(en.sources.length > 0);
  assert.equal(en.matched_type, 'product_attribute');
  const de = await ask('de', 'Welche Oberflächen hat OL-1204?');
  assert.match(de.answer, /Oberflächen|Chrome/);
  assert.match(de.disclaimer, /Quellen|Abruf/);
  const ja = await ask('ja-jp', 'OL-1204の仕上げは？');
  assert.match(ja.answer, /クローム/);
  assert.match(ja.answer, /公開製品ページ/);
  const compare = await ask('en-gb', 'Compare OL-1204 and OL-1205');
  assert.match(compare.answer, /OL-1204/);
  assert.match(compare.answer, /OL-1205/);
  assert.equal(compare.matched_type, 'comparison');
  const moq = await ask('en-gb', 'What is the MOQ for OL-1204?');
  assert.match(moq.answer, /No verified MOQ|not published/i);
  assert.doesNotMatch(moq.answer, /200|300/);
  const missing = await ask('ja-jp', 'ロンドンにショールームはありますか？');
  assert.equal(missing.matched_type, 'fallback');
  assert.match(missing.answer, /確認できません/);
});

test('public product API removes internal provenance but exposes state and published values', async () => {
  const response = await fetch(`${base}/api/products/OL-1204?market=en-gb`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.product.sku, 'OL-1204');
  assert.equal(payload.product.attributes.dimensions.value, '55 × 55 × 70 mm');
  assert.equal(payload.product.attributes.material.status, 'reference');
  assert.ok(!Object.prototype.hasOwnProperty.call(payload.product.attributes.material, 'internal_note'));
  assert.ok(payload.product.finishes.some((finish) => /Chrome/.test(finish.name)));
});

test('admin product and inquiry screens remain available', async () => {
  const admin = new Client();
  await adminLogin(admin);
  const products = await admin.get('/admin/products');
  assert.equal(products.status, 200);
  assert.match(await products.text(), /123|Products/);
  const inquiries = await admin.get('/admin/inquiries');
  assert.equal(inquiries.status, 200);
  const dashboard = await admin.get('/admin');
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Traffic|funnel/i);
});

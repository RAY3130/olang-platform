'use strict';

/*
 * Browser E2E check. Starts a disposable server on an isolated port/database,
 * uses the system Microsoft Edge with Playwright Core (no browser download),
 * and writes screenshots and a JSON result file into analysis/v2/.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'olang-e2e-'));
const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.MSEDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ARTIFACTS = path.resolve(ROOT, '..', 'analysis', 'v2');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const env = {
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  SITE_MODE: 'demo',
  SITE_URL: BASE,
  DB_PATH: path.join(TEST_ROOT, 'e2e.sqlite'),
  UPLOAD_DIR: path.join(TEST_ROOT, 'uploads'),
  ADMIN_INITIAL_USERNAME: 'admin',
  ADMIN_INITIAL_PASSWORD: 'TestAdmin!2026secure',
  EMAIL_TRANSPORT: 'outbox',
  SESSION_COOKIE_SECURE: '0',
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch (_) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('E2E server did not start in time.');
}

async function adminLogin(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill('TestAdmin!2026secure');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/admin`, { timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  const results = { base: BASE, checks: [], screenshots: [], consoleErrors: [], passed: false, startedAt: new Date().toISOString() };
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true, executablePath: EDGE });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => results.consoleErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });

    await page.goto(`${BASE}/en-us`, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /OLANG/);
    assert.match(await page.locator('.market-context-bar').innerText(), /inches/);
    assert.equal(await page.locator('[data-product-card]').count(), 8);
    assert.match(await page.locator('body').innerText(), /OL-1211A/);
    results.checks.push('US market home renders with eight featured product cards');

    await page.getByRole('button', { name: 'Allow analytics' }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('body').getAttribute('data-consent'), '1');
    assert.equal(await page.locator('[data-cookie-banner]').count(), 0);
    results.checks.push('Cookie consent can be granted and the banner is removed');

    await page.goto(`${BASE}/en-us/products?q=OL-1204`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('[data-product-card]').count()) >= 1);
    const exactCard = page.locator('[data-product-card][data-sku="OL-1204"]');
    await exactCard.locator('[data-add-inquiry]').click();
    await exactCard.locator('[data-compare-sku]').check();
    assert.equal(await page.locator('[data-inquiry-count]').first().innerText(), '1');
    const compareHref = await page.locator('[data-compare-link]').first().getAttribute('href');
    assert.match(compareHref, /\/en-us\/compare\?skus=OL-1204/);
    results.checks.push('Inquiry list and comparison selection persist in the browser');

    await page.goto(`${BASE}/en-us/inquiry`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-inquiry-items] .inquiry-item').count(), 1);
    assert.equal(await page.locator('[data-picker-check]:checked').count(), 1);
    await page.locator('[data-picker-row][data-sku="OL-1204"] [data-picker-qty]').fill('600');
    await page.locator('input[name="name"]').fill('E2E Buyer');
    await page.locator('input[name="company"]').fill('E2E Import LLC');
    await page.locator('input[name="email"]').fill('e2e.buyer@example.com');
    await page.locator('input[name="country"]').fill('United States');
    await page.locator('textarea[name="message"]').fill('E2E browser check: please confirm OL-1204 specification, packing and lead time for a 600-piece trial order.');
    await page.locator('input[name="consent"]').check();
    await page.locator('[data-form-type="wholesale"] button[type="submit"]').click();
    await page.waitForURL(/\/en-us\/success\?ref=/, { timeout: 15000 });
    const reference = await page.locator('[data-reference]').innerText();
    assert.match(reference, /^OL-\d{6}-[A-Z0-9]{6}$/);
    assert.match(await page.locator('body').innerText(), /saved|stored/i);
    results.checks.push(`Multi-SKU inquiry submitted from the browser (${reference})`);
    results.screenshots.push(path.join(ARTIFACTS, 'v2-e2e-success.png'));
    await page.screenshot({ path: path.join(ARTIFACTS, 'v2-e2e-success.png'), fullPage: false });

    await page.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
    await page.locator('[data-cookie-banner]').evaluate((el) => el.remove()).catch(() => {});
    await page.locator('[data-assistant-open]').evaluate((el) => el.click());
    await page.locator('#assistant-question').fill('What finish options does OL-1204 have?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.waitForTimeout(800);
    const answer = await page.locator('[data-assistant-answer]').innerText();
    assert.match(answer, /Chrome/);
    assert.match(answer, /Sources/);
    results.checks.push('Knowledge assistant answers a product question with cited sources');
    await page.locator('[data-assistant-close]').click();

    await page.goto(`${BASE}/en/oem`, { waitUntil: 'networkidle' });
    await page.locator('input[name="name"]').fill('OEM E2E');
    await page.locator('input[name="company"]').fill('OEM E2E Studio');
    await page.locator('input[name="email"]').fill('oem.e2e@example.com');
    await page.locator('input[name="country"]').fill('Italy');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('select[name="oem_project_type"]').selectOption('odm');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('select[name="oem_nda"]').selectOption('request-nda');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('textarea[name="message"]').fill('E2E ODM check for an OL-1205 adaptation, private-label packing and a 1,000-piece target.');
    await page.locator('.oem-form input[name="consent"]').check();
    assert.equal(await page.locator('.oem-form button[type="submit"]').isVisible(), true);
    results.checks.push('OEM seven-step wizard reaches the submit step');
    await page.locator('.oem-form button[type="submit"]').click();
    await page.waitForURL(/\/en\/success\?ref=/, { timeout: 15000 });
    results.checks.push('OEM wizard submits to the server and reaches the success page');

    await page.goto(`${BASE}/en-us/products/robe-hook-ol-1204`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-spec-field]').count(), 12);
    assert.match(await page.locator('[data-unit-toggle]').innerText(), /in/);
    await page.locator('[data-unit-toggle]').click();
    assert.equal(await page.locator('body').getAttribute('data-unit-system'), 'metric');
    assert.equal(await page.locator('[data-compare-sku="OL-1204"]').count(), 1);
    results.checks.push('Product page shows all twelve procurement fields and a working mm/inch switch');

    await page.goto(`${BASE}/en/news`, { waitUntil: 'networkidle' });
    assert.match(await page.locator('body').innerText(), /OLANG NEWS|INDUSTRY NEWS/i);
    await page.locator('.news-card h2 a, .news-card h3 a').first().click();
    await page.waitForLoadState('networkidle');
    assert.match(await page.locator('body').innerText(), /published|original source/i);
    results.checks.push('News index and article detail render with source attribution');

    await page.goto(`${BASE}/en/wholesale#project-inquiry`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const projectForm = page.locator('form[data-form-type="project"]');
    await projectForm.locator('input[name="name"]').fill('Project E2E Buyer');
    await projectForm.locator('input[name="company"]').fill('Project E2E Hotels');
    await projectForm.locator('input[name="email"]').fill('project.e2e@example.com');
    await projectForm.locator('input[name="country"]').fill('United Arab Emirates');
    await projectForm.locator('input[name="project_name"]').fill('E2E Marina Hotel');
    await projectForm.locator('select[name="project_type"]').selectOption('hotel');
    await projectForm.locator('input[name="project_location"]').fill('Dubai');
    await projectForm.locator('input[name="product_categories"]').fill('Robe hooks, towel rings, grab bars');
    await projectForm.locator('input[name="estimated_quantity"]').fill('1,200 pcs');
    await projectForm.locator('select[name="required_finish"]').selectOption('Brushed Gold');
    await projectForm.locator('select[name="packaging"]').selectOption('inner-master');
    await projectForm.locator('input[name="delivery_schedule"]').fill('Q3 2027, phased by floor');
    await projectForm.locator('textarea[name="message"]').fill('E2E project inquiry: map the listed product categories and confirm the documentation available for the BOQ.');
    await page.locator('form[data-form-type="project"] input[name="consent"]').check();
    await page.locator('form[data-form-type="project"] button[type="submit"]').click();
    await page.waitForURL(/\/en\/success\?ref=/, { timeout: 15000 });
    const projectReference = await page.locator('[data-reference]').innerText();
    assert.match(projectReference, /^OL-\d{6}-[A-Z0-9]{6}$/);
    results.checks.push(`Project inquiry with BOQ fields reaches the success page (${projectReference})`);

    await page.evaluate(() => window.localStorage.removeItem('olang_inquiry_v1'));
    const assistantPage = await context.newPage();
    await assistantPage.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
    await assistantPage.getByRole('button', { name: /product question|product assistant/i }).click();
    await assistantPage.locator('#assistant-question').fill('Add OL-1204 to my procurement list');
    await assistantPage.getByRole('button', { name: 'Ask', exact: true }).click();
    await assistantPage.waitForTimeout(900);
    assert.match(await assistantPage.locator('[data-assistant-answer]').innerText(), /procurement list/i);
    await assistantPage.locator('.assistant-actions button').first().click();
    assert.equal(await assistantPage.locator('[data-inquiry-count]').first().innerText(), '1');
    await assistantPage.close();
    results.checks.push('Product assistant adds a cited model to the procurement list');

    const de = await context.newPage();
    await de.setViewportSize({ width: 390, height: 844 });
    await de.goto(`${BASE}/de/products/robe-hook-ol-1204`, { waitUntil: 'networkidle' });
    assert.equal(await de.locator('html').getAttribute('lang'), 'de-DE');
    const switchHref = await de.locator('[data-market-switch="en-us"]').getAttribute('href');
    assert.equal(switchHref, `${BASE}/en-us/products/robe-hook-ol-1204`);
    await de.locator('[data-menu-toggle]').click();
    assert.equal(await de.locator('[data-nav]').evaluate((nav) => nav.classList.contains('open')), true);
    results.checks.push('German edition, mobile navigation and path-preserving market switch work');
    results.screenshots.push(path.join(ARTIFACTS, 'v2-e2e-mobile-de.png'));
    await de.screenshot({ path: path.join(ARTIFACTS, 'v2-e2e-mobile-de.png'), fullPage: false });

    const admin = await context.newPage();
    await adminLogin(admin);
    assert.match(await admin.locator('body').innerText(), /Traffic, funnel/);
    await admin.goto(`${BASE}/admin/inquiries`, { waitUntil: 'networkidle' });
    assert.match(await admin.locator('body').innerText(), new RegExp(reference));
    assert.match(await admin.locator('body').innerText(), new RegExp(projectReference));
    await admin.goto(`${BASE}/admin/markets`, { waitUntil: 'networkidle' });
    assert.match(await admin.locator('body').innerText(), /Market configuration and featured models/);
    await admin.goto(`${BASE}/admin/assistant`, { waitUntil: 'networkidle' });
    assert.match(await admin.locator('body').innerText(), /Answer mode:/);
    results.checks.push('Admin can review both inquiry types, market configuration and assistant status');
    results.screenshots.push(path.join(ARTIFACTS, 'v2-e2e-admin.png'));
    await admin.screenshot({ path: path.join(ARTIFACTS, 'v2-e2e-admin.png'), fullPage: false });

    // No-JavaScript fallback: the contact form must still reach the server,
    // validate CSRF/one-time stamp and redirect to a real success page.
    const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1100, height: 900 } });
    const noJs = await noJsContext.newPage();
    await noJs.goto(`${BASE}/en/contact`, { waitUntil: 'load' });
    await noJs.locator('#cookie-banner').evaluate((element) => element.remove());
    await noJs.waitForTimeout(1400);
    await noJs.locator('input[name="name"]').fill('No JS Buyer');
    await noJs.locator('input[name="company"]').fill('No JS Imports');
    await noJs.locator('input[name="email"]').fill('nojs@example.com');
    await noJs.locator('input[name="country"]').fill('United Kingdom');
    await noJs.locator('textarea[name="message"]').fill('No-JavaScript fallback check for the structured contact form.');
    await noJs.locator('input[name="consent"]').check();
    await noJs.locator('#inquiry-form button[type="submit"]').click();
    await noJs.waitForURL(/\/en\/success\?ref=/, { timeout: 15000 });
    assert.match(await noJs.locator('body').innerText(), /Inquiry stored|reference/i);
    results.checks.push('No-JavaScript contact form posts and reaches the success page');
    await noJsContext.close();

    assert.deepEqual(results.consoleErrors, []);
    results.passed = true;
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, 'e2e-results.json'), JSON.stringify(results, null, 2));
    console.log(`E2E passed: ${results.checks.length} checks. Results: ${path.join(ARTIFACTS, 'e2e-results.json')}`);
  } finally {
    if (browser) await browser.close();
    child.kill();
    try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


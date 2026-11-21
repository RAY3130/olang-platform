'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ART = path.resolve(__dirname, '..', '..', 'deliverables', '06_Website_QA', 'screens');

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`${BASE}/en-gb/customization`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Allow analytics' }).click().catch(() => {});
  await page.waitForTimeout(1500);

  // Step 1
  await page.locator('input[name="customer_type"][value="hotel"]').check();
  await page.locator('[data-wizard-next]').click();
  // Step 2
  await page.locator('[data-product-search]').fill('OL-1204');
  await page.locator('[data-custom-product][data-sku="OL-1204"] [data-product-check]').check();
  await page.locator('[data-custom-product][data-sku="OL-1204"] [data-product-qty]').fill('120');
  await page.locator('[data-custom-product][data-sku="OL-1204"] [data-product-finish]').selectOption('Brushed Gold');
  await page.screenshot({ path: path.join(ART, 'e2e-customizer-step2.png') });
  await page.locator('[data-wizard-next]').click();
  // Step 3
  await page.locator('input[name="custom_finish"]').check();
  await page.locator('textarea[name="finish_requirements"]').fill('Brushed Gold for 120 guest bathrooms; sample needed.');
  await page.locator('input[name="custom_size"]').check();
  await page.locator('textarea[name="target_dimensions"]').fill('Hole spacing to match the existing wall drilling plan; drawing attached.');
  const sample = path.join(ART, 'qa-sample-drawing.pdf');
  fs.writeFileSync(sample, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  await page.locator('input[name="attachments"]').setInputFiles(sample);
  await page.locator('[data-wizard-next]').click();
  // Step 4
  await page.locator('input[name="project_country"]').fill('United Kingdom');
  await page.locator('select[name="project_type"]').selectOption('hotel');
  await page.locator('input[name="project_scale"]').fill('120 rooms');
  await page.locator('input[name="bathrooms_count"]').fill('120 bathrooms');
  await page.locator('input[name="required_series"]').fill('1200 Series');
  await page.locator('[data-wizard-next]').click();
  // Step 5
  await page.waitForTimeout(300);
  const summary = await page.locator('[data-customizer-summary]').innerText();
  if (!/OL-1204/.test(summary) || !/120/.test(summary)) throw new Error('Summary missing product/quantity: ' + summary.slice(0, 300));
  await page.screenshot({ path: path.join(ART, 'e2e-customizer-summary.png') });
  await page.locator('[data-wizard-next]').click();
  // Step 6
  await page.locator('input[name="contact_name"]').fill('E2E Hotel Buyer');
  await page.locator('input[name="company"]').fill('E2E Hospitality Group');
  await page.locator('input[name="email"]').fill('hotel.e2e@example.com');
  await page.locator('input[name="country"]').fill('United Kingdom');
  await page.locator('select[name="request_type"]').selectOption('sample');
  await page.locator('textarea[name="message"]').fill('QA end-to-end customization request. No real sales delivery expected.');
  await page.locator('input[name="consent"]').check();
  await page.locator('[data-wizard-submit]').click();
  await page.waitForURL(/\/en-gb\/customization\/success\?ref=/, { timeout: 20000 });
  const reference = await page.locator('[data-customizer-reference]').innerText();
  await page.screenshot({ path: path.join(ART, 'e2e-customizer-success.png') });
  console.log('SUCCESS', reference);
  console.log('ERRORS', errors.length ? errors : 'none');
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

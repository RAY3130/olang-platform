'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(__dirname, '..', '..', '..', 'deliverables', '06_Website_QA');

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/en-gb/customization`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Allow analytics/i }).click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.locator('[data-wizard-back]').isDisabled().catch(() => true);
  const results = [];
  for (const type of ['wholesale', 'hotel', 'oem', 'architect', 'other']) {
    await page.locator(`input[name="customer_type"][value="${type}"]`).check();
    await page.waitForTimeout(150);
    const panel = page.locator(`[data-buyer-panel="${type}"]`);
    const active = await panel.evaluate((node) => node.classList.contains('is-active')).catch(() => false);
    const fields = await panel.locator('input, textarea, select').count().catch(() => 0);
    results.push({ customer_type: type, panel_active: active, fields });
  }
  fs.writeFileSync(path.join(OUT, 'customizer-types.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    base: BASE,
    method: 'Automated browser check of the buyer-type selector and conditional field panels.',
    results,
  }, null, 2));
  console.log(results);
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

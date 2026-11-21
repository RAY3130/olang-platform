'use strict';

/**
 * Scripted journeys producing controlled, consented QA analytics.
 * All journeys are synthetic and are declared as such in the analysis.
 */
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function consent(page) {
  await page.getByRole('button', { name: /Allow analytics|Analyse erlauben|アクセス解析を許可/ }).click().catch(() => {});
  await page.waitForTimeout(1300);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
}

async function journey(browser, market, pathname, steps) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: market === 'de' ? 'de-DE' : market === 'ja-jp' ? 'ja-JP' : 'en-GB' });
  const page = await context.newPage();
  await page.goto(`${BASE}/${market}${pathname}`, { waitUntil: 'networkidle' });
  await consent(page);
  const visited = [page.url()];
  for (const step of steps) {
    try {
      await step(page);
      visited.push(page.url());
      await page.waitForTimeout(450);
    } catch (error) {
      console.warn(`[${market}] step skipped:`, error.message.slice(0, 160));
    }
  }
  await page.waitForTimeout(700);
  await context.close();
  console.log(market, visited.length, 'pages');
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  // UK: discovery -> filter -> product detail -> add to quote -> start customizer, abandon at step 2.
  await journey(browser, 'en-gb', '', [
    async (page) => { await page.goto(`${BASE}/en-gb/products`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300); },
    async (page) => { await page.locator('select[name="series"]').selectOption('1200 Series'); await page.locator('[data-filter-form] button[type="submit"]').click(); await page.waitForLoadState('domcontentloaded'); },
    async (page) => { await page.locator('a[href$="/products/towel-ring-ol-1205"]').first().click(); await page.waitForLoadState('domcontentloaded'); },
    async (page) => { await page.locator('.product-detail-copy [data-add-inquiry]').first().click(); await page.waitForTimeout(300); },
    async (page) => { await page.goto(`${BASE}/en-gb/customization?sku=OL-1205`, { waitUntil: 'domcontentloaded' }); await page.locator('[data-wizard-next]').click(); await page.waitForTimeout(300); },
  ]);

  // DE: product reference -> assistant question -> resource request page.
  await journey(browser, 'de', '/products/robe-hook-ol-1204', [
    async (page) => { await page.locator('[data-photo-thumb][data-finish-label="Brushed Gold"]').click(); await page.waitForTimeout(200); },
    async (page) => { await page.locator('[data-open-assistant]').first().click(); await page.locator('#assistant-question').fill('Welche Oberflächen hat OL-1204?'); await page.locator('[data-assistant-form] button[type="submit"]').click(); await page.waitForTimeout(900); },
    async (page) => { await page.goto(`${BASE}/de-de/resources`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300); },
  ]);

  // JP: case detail -> customizer, stop at customization step.
  await journey(browser, 'ja-jp', '/projects/shangri-la-hotel-singapore', [
    async (page) => { await page.locator('a[href*="customization?project="]').first().click(); await page.waitForLoadState('domcontentloaded'); },
    async (page) => { await page.locator('[data-wizard-next]').click(); await page.waitForTimeout(300); },
    async (page) => { await page.locator('[data-custom-product][data-sku="OL-1204"] [data-product-check]').check(); await page.locator('[data-product-qty]').first().fill('60'); await page.locator('[data-wizard-next]').click(); await page.waitForTimeout(300); },
    async (page) => { await page.locator('input[name="custom_finish"]').check(); await page.locator('textarea[name="finish_requirements"]').fill('クロームで統一'); await page.waitForTimeout(300); },
  ]);

  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

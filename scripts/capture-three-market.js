'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUT = path.resolve(__dirname, '..', '..', 'deliverables', '06_Website_QA', 'screens');
const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = [
  ['uk-home', '/en-gb', 1440, 1000],
  ['de-home', '/de-de', 1440, 1000],
  ['ja-home', '/ja-jp', 1440, 1000],
  ['uk-products', '/en-gb/products', 1440, 1000],
  ['de-products', '/de-de/products', 1440, 1000],
  ['ja-products', '/ja-jp/products', 1440, 1000],
  ['uk-product', '/en-gb/products/robe-hook-ol-1204', 1440, 1000],
  ['de-product', '/de-de/products/robe-hook-ol-1204', 1440, 1000],
  ['ja-product', '/ja-jp/products/robe-hook-ol-1204', 1440, 1000],
  ['uk-project', '/en-gb/projects/shangri-la-hotel-singapore', 1440, 1000],
  ['ja-customizer', '/ja-jp/customization', 1440, 1000],
  ['uk-customizer', '/en-gb/customization', 1440, 1000],
  ['de-customizer', '/de-de/customization', 1440, 1000],
  ['ja-mobile-home', '/ja-jp', 390, 844],
  ['ja-mobile-product', '/ja-jp/products/robe-hook-ol-1204', 390, 844],
  ['ja-mobile-customizer', '/ja-jp/customization', 390, 844],
  ['de-mobile-product', '/de-de/products/towel-ring-ol-1205', 390, 844],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [name, pathname, width, height] of PAGES) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-GB' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(BASE + pathname, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    console.log(`${name} ${await page.title()}${errors.length ? ` ERRORS: ${errors.join(' | ')}` : ''}`);
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

// Capture the pages the report and the QA record describe, so the layout can be checked by eye.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUT = path.resolve(__dirname, '..', '..', 'deliverables', '05_QA', 'shots');
const BASE = 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const PAGES = [
  ['listing-en', '/en-us/products', 1440, 1000],
  ['product-en', '/en-us/products/robe-hook-ol-1204', 1440, 1000],
  ['product-de', '/de/products/robe-hook-ol-1204', 1440, 1000],
  ['home-en', '/en-us', 1440, 1000],
  ['resources', '/en-us/resources', 1440, 1000],
  ['contact', '/en-us/contact', 1440, 1000],
  ['honor', '/en-us/about/honor', 1440, 1000],
  ['product-mobile', '/en-us/products/robe-hook-ol-1204', 390, 844],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [name, pathname, width, height] of PAGES) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(BASE + pathname, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`${name} -> ${path.basename(file)}`);
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

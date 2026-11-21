'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(__dirname, '..', '..', '..', 'deliverables', '08_presentation_localization', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const MARKETS = [
  ['en-gb', '/en-gb'],
  ['de-de', '/de-de'],
  ['ja-jp', '/ja-jp'],
];
const PAGES = [
  ['home', ''],
  ['products', '/products'],
  ['product', '/products/single-towel-bar-ol-1208'],
  ['series', '/series/1200'],
  ['contact', '/contact'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    for (const [market, prefix] of MARKETS) {
      for (const [label, suffix] of PAGES) {
        await page.goto(BASE + prefix + suffix, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: '.cookie-banner{display:none!important}' });
        await page.waitForTimeout(250);
        const file = path.join(OUT, `${market}-${label}-${width}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(path.basename(file));
      }
    }
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

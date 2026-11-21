'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(__dirname, '..', '..', '..', 'deliverables', '08_Design_Assets', 'final-screens');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['uk-home', '/en-gb'], ['de-home', '/de-de'], ['ja-home', '/ja-jp'],
  ['uk-products', '/en-gb/products'], ['ja-products', '/ja-jp/products'],
  ['uk-product', '/en-gb/products/robe-hook-ol-1204'], ['ja-product', '/ja-jp/products/robe-hook-ol-1204'],
  ['uk-project', '/en-gb/projects/shangri-la-hotel-singapore'], ['ja-project', '/ja-jp/projects/shangri-la-hotel-singapore'],
  ['uk-customizer', '/en-gb/customization'], ['ja-customizer', '/ja-jp/customization'],
  ['uk-about', '/en-gb/about'], ['ja-about', '/ja-jp/about'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/en-gb`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Allow analytics/i }).click().catch(() => {});
  await page.waitForTimeout(1300);
  for (const [name, pathname] of PAGES) {
    await page.goto(BASE + pathname, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('#cookie-banner')?.remove());
    // Scroll through the document so native lazy-loading fires, then return to
    // the top before the full-page capture.
    await page.evaluate(async () => {
      const step = 500;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 900));
      for (const image of document.images) {
        image.loading = 'eager';
        if (!image.complete) {
          const source = image.getAttribute('src');
          image.setAttribute('src', '');
          image.setAttribute('src', source);
        }
      }
      await Promise.all([...document.images].map((image) => image.decode().catch(() => null)));
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.addStyleTag({ content: `
      .site-header, .market-strip, .site-nav, .assistant-launcher, .assistant-panel, .cookie-banner { position: static !important; }
      .site-header, .market-context-bar, .market-strip, .assistant-launcher, .assistant-panel, .cookie-banner, .skip-link { display: none !important; }
    ` });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });
    console.log(name, await page.title());
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

/**
 * Measure what a browser actually transfers for the pages the report talks about.
 *
 * The numbers come from the Performance API after a real page load in the local Edge build:
 * DOMContentLoaded and load from `performance.timing`, transferred bytes and request count from
 * the resource entries. This is the same instrument the report quotes in the technical section.
 *
 * Usage: node scripts/measure-page-weight.js [--base http://127.0.0.1:4174]
 */

const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:4174';
const OUT = path.resolve(__dirname, '..', '..', 'deliverables', '05_QA', 'page-weight.json');

const PAGES = [
  ['listing', '/en-us/products'],
  ['product', '/en-us/products/robe-hook-ol-1204'],
  ['home', '/en-us'],
];

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  const { chromium } = require('playwright-core');
  const executablePath = findBrowser();
  if (!executablePath) {
    console.error('no Chromium-based browser found');
    process.exitCode = 1;
    return;
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  try {
    for (const [label, pathname] of PAGES) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(BASE + pathname, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(1200);
      const metrics = await page.evaluate(() => {
        const timing = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        const sum = (filter) => resources.filter(filter).reduce((total, entry) => total + (entry.transferSize || 0), 0);
        return {
          domContentLoadedMs: timing ? Math.round(timing.domContentLoadedEventEnd) : null,
          loadMs: timing ? Math.round(timing.loadEventEnd) : null,
          transferBytes: timing ? timing.transferSize + resources.reduce((total, entry) => total + (entry.transferSize || 0), 0) : null,
          imageBytes: sum((entry) => entry.initiatorType === 'img'),
          scriptBytes: sum((entry) => entry.initiatorType === 'script'),
          styleBytes: sum((entry) => entry.initiatorType === 'link'),
          requests: resources.length,
        };
      });
      results.push({ label, pathname, ...metrics, transferKB: Math.round((metrics.transferBytes || 0) / 1024) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), base: BASE, results }, null, 2), 'utf8');
  for (const row of results) {
    console.log(`${row.label.padEnd(8)} DCL ${row.domContentLoadedMs} ms · load ${row.loadMs} ms · ${row.transferKB} KB · ${row.requests} requests`);
  }
  console.log('written: ' + path.relative(process.cwd(), OUT));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

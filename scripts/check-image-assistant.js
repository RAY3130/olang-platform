'use strict';

/**
 * Image + assistant acceptance audit for the 2026-11-17 optimisation round.
 *
 * It checks the measurements promised in the brief:
 *  - 20 product pages: frame ratio follows the source, 2:1 bands are small, no upscaling;
 *  - 123 cards: 4:3, >=4.5% safety margin, median product height 68–78% of the canvas;
 *  - assistant: home/list/PDP at 1440/1024/768/390, touch target, contrast, nudge once,
 *    panel/Esc/focus, collision sweep and no console errors.
 *
 * Usage: npm run qa:image-assistant
 * The local server must be running on :4174.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(ROOT, '..', 'deliverables', '09_image_assistant');
const DB = new DatabaseSync(path.join(ROOT, 'storage', 'olang.sqlite'));
const CARD_DIR = path.join(ROOT, 'public', 'images', 'products', 'official', 'cards');
const CARD_BACKUP = path.join(ROOT, 'storage', 'backup_cards_pre_a2');

fs.mkdirSync(OUT, { recursive: true });

function ratioBand(srcRatio, frameRatio) {
  if (!srcRatio || !frameRatio) return 1;
  return srcRatio > frameRatio ? 1 - frameRatio / srcRatio : 1 - srcRatio / frameRatio;
}

function luminance(rgb) {
  const values = rgb.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number).map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function cardMetrics() {
  const files = fs.readdirSync(CARD_DIR)
    .filter((file) => file.endsWith('.jpg') && !/-400\.jpg$/.test(file))
    .sort();
  const rows = [];
  for (const file of files) {
    const filePath = path.join(CARD_DIR, file);
    const meta = await sharp(filePath).metadata();
    const trimmed = await sharp(filePath).trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
    const width = trimmed.info.width;
    const height = trimmed.info.height;
    const marginX = (900 - width) / 2 / 900;
    const marginY = (675 - height) / 2 / 675;
    const backupPath = path.join(CARD_BACKUP, file);
    const sizeRatio = fs.existsSync(backupPath) ? fs.statSync(filePath).size / fs.statSync(backupPath).size : null;
    rows.push({
      sku: file.replace(/\.jpg$/, ''),
      canvas: [meta.width, meta.height],
      productBox: [width, height],
      minMargin: Math.min(marginX, marginY),
      marginX,
      marginY,
      heightRatio: height / 675,
      sizeRatio,
      pass: meta.width === 900 && meta.height === 675 && Math.min(marginX, marginY) >= 0.045
        && (sizeRatio == null || sizeRatio <= 1.15),
    });
  }
  const heights = rows.map((row) => row.heightRatio).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return {
    count: rows.length,
    pass: rows.filter((row) => row.pass).length,
    fail: rows.filter((row) => !row.pass).length,
    medianHeight: median,
    minMargin: Math.min(...rows.map((row) => row.minMargin)),
    rows,
    summaryPass: rows.every((row) => row.pass) && median >= 0.68 && median <= 0.78,
  };
}

async function main() {
  const result = {
    started_at: new Date().toISOString(),
    base: BASE,
    image: {},
    cards: {},
    assistant: {},
    consoleErrors: [],
    pass: false,
  };
  result.cards = await cardMetrics();

  const ratios = DB.prepare(`
    SELECT p.sku, p.slug, MAX(ia.aspect_ratio) AS ratio,
           MAX(ia.natural_width) AS width, MAX(ia.natural_height) AS height
    FROM products p JOIN image_assets ia ON ia.product_id = p.id AND ia.kind = 'product'
    WHERE p.published = 1 GROUP BY p.id ORDER BY p.sku
  `).all();
  const square = ratios.filter((row) => Number(row.ratio) <= 1.2).slice(0, 10);
  const landscape = ratios.filter((row) => Number(row.ratio) >= 1.9).slice(0, 10);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(`console: ${message.text()}`); });

  const frameRows = [];
  for (const [group, items] of [['1:1', square], ['2:1', landscape]]) {
    for (const item of items) {
      await page.goto(`${BASE}/en-gb/products/${item.slug}`, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: '.cookie-banner{display:none!important}' }).catch(() => {});
      const measurement = await page.evaluate(() => {
        const frame = document.querySelector('.photo-frame');
        const image = frame && frame.querySelector('img');
        if (!frame || !image) return null;
        const fr = frame.getBoundingClientRect();
        const ir = image.getBoundingClientRect();
        return {
          frame: [fr.width, fr.height],
          image: [ir.width, ir.height],
          frameRatio: fr.width / fr.height,
          natural: [image.naturalWidth, image.naturalHeight],
          objectFit: getComputedStyle(image).objectFit,
          className: frame.className,
        };
      });
      if (!measurement) {
        frameRows.push({ group, sku: item.sku, pass: false, error: 'missing frame' });
        continue;
      }
      const sourceRatio = Number(item.ratio);
      const band = ratioBand(sourceRatio, measurement.frameRatio);
      const noUpscale = measurement.image[0] <= Number(item.width) + 1 && measurement.image[1] <= Number(item.height) + 1;
      const pass = Math.abs(measurement.frameRatio - sourceRatio) <= 0.04
        && band <= 0.04
        && measurement.objectFit === 'contain'
        && noUpscale;
      frameRows.push({
        group,
        sku: item.sku,
        sourceRatio,
        frameRatio: Number(measurement.frameRatio.toFixed(4)),
        band: Number(band.toFixed(4)),
        image: measurement.image.map((value) => Math.round(value)),
        natural: measurement.natural,
        objectFit: measurement.objectFit,
        className: measurement.className,
        pass,
      });
    }
  }
  const heroRows = [];
  for (const width of [1440, 768, 390]) {
    const heroContext = await browser.newContext({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
    const heroPage = await heroContext.newPage();
    await heroPage.goto(`${BASE}/en-gb`, { waitUntil: 'networkidle' });
    const hero = await heroPage.evaluate(() => {
      const frame = document.querySelector('.v3-hero-figure .reference-picture');
      const image = frame && frame.querySelector('img');
      if (!frame || !image) return null;
      const fr = frame.getBoundingClientRect();
      const ir = image.getBoundingClientRect();
      return { frameRatio: fr.width / fr.height, sourceRatio: image.naturalWidth / image.naturalHeight, imageRatio: ir.width / ir.height };
    });
    const heroBand = hero ? ratioBand(hero.sourceRatio, hero.frameRatio) : 1;
    heroRows.push({ width, ...hero, band: Number(heroBand.toFixed(4)), pass: Boolean(hero && Math.abs(hero.frameRatio - 1.5) <= 0.01 && heroBand <= 0.04) });
    await heroContext.close();
  }
  const hero = heroRows[0];
  result.image = {
    hero,
    heroRows,
    pages: frameRows,
    pass: frameRows.filter((row) => row.pass).length,
    fail: frameRows.filter((row) => !row.pass).length,
    band2x1Max: Math.max(...frameRows.filter((row) => row.group === '2:1').map((row) => row.band)),
    summaryPass: frameRows.every((row) => row.pass) && heroRows.every((row) => row.pass),
  };

  const assistantPages = ['/en-gb', '/en-gb/products', '/en-gb/products/single-towel-bar-ol-1208'];
  const visibility = [];
  for (const width of [1440, 1024, 768, 390]) {
    for (const pathname of assistantPages) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(BASE + pathname, { waitUntil: 'networkidle' });
      await p.waitForTimeout(250);
      const button = p.locator('.assistant-toggle');
      const visible = await button.isVisible().catch(() => false);
      const box = await button.boundingBox().catch(() => null);
      const styles = await button.evaluate((el) => {
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, color: s.color, icon: Boolean(el.querySelector('svg')), label: el.getAttribute('aria-label') };
      }).catch(() => null);
      const target = width <= 640 ? 48 : 44;
      const pass = visible && box && box.width >= target && box.height >= target
        && styles && contrast(styles.background, styles.color) >= 4.5;
      visibility.push({ width, path: pathname, visible, box, styles, contrast: styles ? Number(contrast(styles.background, styles.color).toFixed(2)) : 0, pass });
      await ctx.close();
    }
  }

  let collisionHits = 0;
  for (const width of [1440, 1024, 768, 390]) {
    for (const pathname of assistantPages) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(BASE + pathname, { waitUntil: 'networkidle' });
      const height = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let index = 0; index < 15; index += 1) {
        await p.evaluate((y) => window.scrollTo(0, y), Math.round((height - 900) * index / 14));
        await p.waitForTimeout(450);
        const hits = await p.evaluate(() => {
          const toggle = document.querySelector('.assistant-toggle');
          if (!toggle || getComputedStyle(toggle).display === 'none') return 0;
          const b = toggle.getBoundingClientRect();
          return [...document.querySelectorAll('a,button,input,select,textarea')].filter((element) => {
            if (element === toggle || element.closest('[data-assistant-panel]')) return false;
            const r = element.getBoundingClientRect();
            return r.width && Math.min(b.right, r.right) - Math.max(b.left, r.left) > 4
              && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 4;
          }).length;
        });
        collisionHits += hits;
      }
      await ctx.close();
    }
  }

  const clsContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await clsContext.addInitScript(() => {
    window.__assistantCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__assistantCls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const clsPage = await clsContext.newPage();
  await clsPage.goto(BASE + '/en-gb', { waitUntil: 'networkidle' });
  await clsPage.waitForTimeout(600);
  const cls = await clsPage.evaluate(() => window.__assistantCls || 0);
  await clsContext.close();

  const nudgeContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const nudgePage = await nudgeContext.newPage();
  await nudgePage.goto(BASE + '/en-gb', { waitUntil: 'networkidle' });
  await nudgePage.waitForTimeout(1800);
  const nudgeFirst = await nudgePage.locator('[data-assistant-nudge]').isVisible();
  await nudgePage.reload({ waitUntil: 'networkidle' });
  await nudgePage.waitForTimeout(1800);
  const nudgeSecond = await nudgePage.locator('[data-assistant-nudge]').isVisible();
  await nudgePage.locator('.assistant-toggle').click();
  const openStart = Date.now();
  const panelVisible = await nudgePage.locator('[data-assistant-panel]').isVisible();
  const backdropVisible = await nudgePage.locator('[data-assistant-backdrop]').isVisible();
  const expanded = await nudgePage.locator('.assistant-toggle').getAttribute('aria-expanded');
  const openDuration = Date.now() - openStart;
  await nudgePage.keyboard.press('Escape');
  await nudgePage.waitForTimeout(50);
  const closeDuration = Date.now() - openStart;
  const panelHidden = await nudgePage.locator('[data-assistant-panel]').isHidden();
  const focusReturned = await nudgePage.evaluate(() => document.activeElement && document.activeElement.classList.contains('assistant-toggle'));
  await nudgeContext.close();

  result.assistant = {
    visibility,
    visible: visibility.filter((row) => row.pass).length + '/' + visibility.length,
    collisionHits,
    nudgeFirst,
    nudgeSecond,
    panel: { panelVisible, backdropVisible, expanded, closeDuration, openDuration, panelHidden, focusReturned },
    cls,
    pass: visibility.every((row) => row.pass) && collisionHits === 0 && nudgeFirst && !nudgeSecond
      && panelVisible && backdropVisible && expanded === 'true' && panelHidden && focusReturned && closeDuration < 150 && cls <= 0.02,
  };
  result.consoleErrors = [...new Set(result.consoleErrors)];
  result.pass = Boolean(result.image.summaryPass && result.cards.summaryPass && result.assistant.pass && result.consoleErrors.length === 0);
  result.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'image-assistant-results.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    pass: result.pass,
    image: { pass: result.image.pass, fail: result.image.fail, band2x1Max: result.image.band2x1Max, heroBand: result.image.hero && result.image.hero.band },
    cards: { pass: result.cards.pass, fail: result.cards.fail, medianHeight: result.cards.medianHeight, minMargin: result.cards.minMargin },
    assistant: { visible: result.assistant.visible, collisionHits, nudgeFirst: result.assistant.nudgeFirst, nudgeSecond: result.assistant.nudgeSecond, cls: result.assistant.cls },
    consoleErrors: result.consoleErrors,
    output: path.relative(ROOT, path.join(OUT, 'image-assistant-results.json')),
  }, null, 2));
  if (!result.pass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

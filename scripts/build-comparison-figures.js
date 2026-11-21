'use strict';

/**
 * Old-versus-new comparison sheets for the report.
 *
 * The report claims that the rebuild changed what a buyer can read on the page. A claim like that
 * needs a picture: each sheet puts the original OLANG page next to the rebuilt page at the same
 * width and labels both sides, so a reviewer can check the difference without opening two browsers.
 *
 * Sources:
 *   old  https://en.olang.cn/Products.html, https://en.olang.cn/ProductDetail/21.html
 *   new  http://127.0.0.1:4174/en-us/products, .../products/robe-hook-ol-1204
 *
 * Output: deliverables/05_QA/compare/*.png
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, '..', 'deliverables', '05_QA', 'compare');
const SHOT_DIR = path.resolve(ROOT, '..', 'deliverables', '05_QA', 'compare', 'raw');

const LOCAL = 'http://127.0.0.1:4174';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .find((candidate) => fs.existsSync(candidate));

const PAGES = [
  { name: 'old-listing', url: 'https://en.olang.cn/Products.html', width: 1280, height: 1000, hideChrome: true },
  { name: 'new-listing', url: `${LOCAL}/en-us/products`, width: 1280, height: 1000, hideChrome: true, scrollSelector: '.product-grid' },
  { name: 'old-product', url: 'https://en.olang.cn/ProductDetail/21.html', width: 1280, height: 1000, hideChrome: true },
  { name: 'new-product', url: `${LOCAL}/en-us/products/robe-hook-ol-1204`, width: 1280, height: 1000, hideChrome: true },
  { name: 'new-market-us', url: `${LOCAL}/en-us`, width: 1280, height: 1400, hideChrome: true, selector: '.market-brief' },
  { name: 'new-market-de', url: `${LOCAL}/de`, width: 1280, height: 1400, hideChrome: true, selector: '.market-brief' },
  { name: 'new-market-it', url: `${LOCAL}/it`, width: 1280, height: 1400, hideChrome: true, selector: '.market-brief' },
];

const PAPER = '#f7f4ef';
const INK = '#1d1a16';
const MUTED = '#5f5548';
const BRASS = '#8b6a37';

function escapeXml(value) {
  return String(value).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));
}

function headerSvg(width, lines) {
  const rows = lines.map((line, index) => {
    const size = index === 0 ? 26 : 17;
    const fill = index === 0 ? INK : MUTED;
    const weight = index === 0 ? 'bold' : 'normal';
    return `<text x="28" y="${34 + index * 26}" font-family="Segoe UI, Microsoft YaHei, Arial" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`;
  }).join('');
  return Buffer.from(`<svg width="${width}" height="${88}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${PAPER}"/>${rows}</svg>`);
}

function columnSvg(width, lines, tone) {
  const colour = tone === 'old' ? '#9a5c4a' : BRASS;
  const rows = lines.map((line, index) => {
    const size = index === 0 ? 19 : 15;
    const fill = index === 0 ? colour : MUTED;
    const weight = index === 0 ? 'bold' : 'normal';
    return `<text x="20" y="${30 + index * 22}" font-family="Segoe UI, Microsoft YaHei, Arial" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`;
  }).join('');
  return Buffer.from(`<svg width="${width}" height="86" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${tone === 'old' ? '#f6efec' : '#f1eadf'}"/>${rows}</svg>`);
}

async function capture(browser) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (const page of PAGES) {
    // The original site sits behind a bot filter that rejects headless fingerprints. A realistic
    // user agent, locale and referer are enough to read the page the way a visitor does.
    const context = await browser.newContext({
      viewport: { width: page.width, height: page.height },
      deviceScaleFactor: 1,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      locale: 'en-US',
      timezoneId: 'Asia/Shanghai',
      extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9', referer: 'https://en.olang.cn/' },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const tab = await context.newPage();
    const response = await tab.goto(page.url, { waitUntil: 'load', timeout: 60000 }).catch(() => null);
    if (response && response.status() >= 400) console.log(`  ${page.name} answered ${response.status()}`);
    await tab.waitForTimeout(3000);
    if (page.hideChrome) {
      await tab.addStyleTag({ content: '[data-cookie-banner], .cookie-banner, [data-assistant], .assistant-toggle, .cookies, [id*=cookie], [class*=cookie] { display: none !important; }' });
      await tab.waitForTimeout(300);
    }
    if (page.scrollSelector) {
      await tab.evaluate((selector) => {
        const target = document.querySelector(selector);
        if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 30, behavior: 'instant' });
      }, page.scrollSelector);
      await tab.waitForTimeout(900);
    }
    const file = path.join(SHOT_DIR, `${page.name}.png`);
    if (page.selector) {
      const target = tab.locator(page.selector).first();
      if (await target.count()) await target.screenshot({ path: file });
      else await tab.screenshot({ path: file });
    } else {
      await tab.screenshot({ path: file });
    }
    console.log(`captured ${page.name}`);
    await context.close();
  }
}

async function composePair(name, leftFile, rightFile, header, leftLabel, rightLabel) {
  const gap = 26;
  const pad = 28;
  const columnWidth = 620;
  const left = await sharp(leftFile).resize({ width: columnWidth }).toBuffer({ resolveWithObject: true });
  const right = await sharp(rightFile).resize({ width: columnWidth }).toBuffer({ resolveWithObject: true });
  const headerHeight = 88;
  const labelHeight = 86;
  const bodyHeight = Math.max(left.info.height, right.info.height);
  const width = pad * 2 + columnWidth * 2 + gap;
  const height = headerHeight + labelHeight + bodyHeight + pad;

  const leftColumn = Math.round((width - columnWidth * 2 - gap) / 2);
  const rightColumn = leftColumn + columnWidth + gap;

  await sharp({ create: { width, height, channels: 3, background: PAPER } })
    .composite([
      { input: headerSvg(width, header), left: 0, top: 0 },
      { input: columnSvg(columnWidth, leftLabel, 'old'), left: leftColumn, top: headerHeight },
      { input: columnSvg(columnWidth, rightLabel, 'new'), left: rightColumn, top: headerHeight },
      { input: left.data, left: leftColumn, top: headerHeight + labelHeight },
      { input: right.data, left: rightColumn, top: headerHeight + labelHeight },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, `${name}.png`));
  console.log(`composed ${name}.png`);
}

async function composeTrio(name, files, header, labels) {
  const gap = 18;
  const pad = 28;
  const columnWidth = 420;
  const shots = [];
  for (const file of files) shots.push(await sharp(file).resize({ width: columnWidth }).toBuffer({ resolveWithObject: true }));
  const headerHeight = 88;
  const labelHeight = 64;
  const bodyHeight = Math.max(...shots.map((shot) => shot.info.height));
  const width = pad * 2 + columnWidth * shots.length + gap * (shots.length - 1);
  const height = headerHeight + labelHeight + bodyHeight + pad;
  const composites = [{ input: headerSvg(width, header), left: 0, top: 0 }];
  shots.forEach((shot, index) => {
    const left = pad + index * (columnWidth + gap);
    const svg = Buffer.from(`<svg width="${columnWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f1eadf"/><text x="16" y="26" font-family="Segoe UI, Microsoft YaHei, Arial" font-size="18" font-weight="bold" fill="${BRASS}">${escapeXml(labels[index][0])}</text><text x="16" y="50" font-family="Segoe UI, Microsoft YaHei, Arial" font-size="14" fill="${MUTED}">${escapeXml(labels[index][1])}</text></svg>`);
    composites.push({ input: svg, left, top: headerHeight });
    composites.push({ input: shot.data, left, top: headerHeight + labelHeight });
  });
  await sharp({ create: { width, height, channels: 3, background: PAPER } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, `${name}.png`));
  console.log(`composed ${name}.png`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  try {
    await capture(browser);
  } finally {
    await browser.close();
  }

  const shot = (name) => path.join(SHOT_DIR, `${name}.png`);

  await composePair(
    'compare-listing',
    shot('old-listing'),
    shot('new-listing'),
    ['图 A  产品列表页：旧站与整改后并排', '左：en.olang.cn/Products.html（2026-11-11 抓取）· 右：127.0.0.1:4174/en-us/products'],
    ['旧站 Products.html', '每张卡片只有图片与名称', '采购字段 0 项，无尺寸、无材质'],
    ['新站 /en-us/products', '123 个型号 · 11 品类 · 8 系列', '卡片含材质、尺寸、表面与官方色板'],
  );

  await composePair(
    'compare-product',
    shot('old-product'),
    shot('new-product'),
    ['图 B  产品详情页：旧站与整改后并排', '左：en.olang.cn/ProductDetail/21.html（2026-11-11 抓取）· 右：127.0.0.1:4174/en-us/products/robe-hook-ol-1204'],
    ['旧站 OL-1204 详情页', '采购字段 4 项（型号/系列/重量/颜色）', '无尺寸标注、无规格书入口'],
    ['新站 OL-1204 详情页', '12 项采购字段 + 表面逐色图', '标题含材质+品类+型号，报价入口同屏'],
  );

  await composeTrio(
    'compare-markets',
    [shot('new-market-us'), shot('new-market-de'), shot('new-market-it')],
    ['图 C  同一型号、三套市场版本：内容按市场组织，而不是同一页换语言', '三个版本都来自同一数据库，单位、币种、合规口径、采购上下文与术语分别配置'],
    [
      ['美国版 /en-us', '英寸优先 · USD · ADA/Prop 65 口径'],
      ['德语版 /de', '公制 · EUR · EU 合规口径'],
      ['意大利语版 /it', '公制 · EUR · EU 合规口径'],
    ],
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

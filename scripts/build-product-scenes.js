'use strict';

/**
 * Product-specific illustrative scenes for five published models.
 * Real product photograph composited onto an AI-generated bathroom. Labelled
 * on the image as illustrative, not to scale and not a project installation.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(ROOT, 'public', 'images', 'concepts');
const CUT = path.join(OUT, 'cutouts');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CUT, { recursive: true });

const MARKETS = {
  'en-gb': { file: 'uk-bathroom.jpg', backgroundSize: 'cover', backgroundPosition: '50% 62%' },
  de: { file: 'de-bathroom.jpg', backgroundSize: 'cover', backgroundPosition: '50% 48%' },
  'ja-jp': { file: 'jp-bathroom.jpg', backgroundSize: '132%', backgroundPosition: '83% 58%' },
};

const PRODUCTS = [
  { sku: 'OL-1204', finish: 'Chrome', file: 'public/images/products/official/colors/OL-1204/chrome.jpg', width: '9%', left: '55%', top: '28%', rotate: '0deg' },
  { sku: 'OL-1205', finish: 'Chrome', file: 'public/images/products/official/colors/OL-1205/chrome.jpg', width: '15%', left: '48%', top: '27%', rotate: '0deg' },
  { sku: 'OL-1208', finish: 'Brushed Gold', file: 'public/images/products/official/colors/OL-1208/brushed-gold.jpg', width: '30%', left: '54%', top: '27%', rotate: '-1deg' },
  { sku: 'OL-1209', finish: 'Chrome', file: 'public/images/products/official/colors/OL-1209/chrome.jpg', width: '32%', left: '48%', top: '29%', rotate: '0deg' },
  { sku: 'OL-5201B', finish: 'Chrome', file: 'public/images/products/official/OL-5201B.jpg', width: '15%', left: '62%', top: '24%', rotate: '0deg' },
];

async function cutout(page, absoluteFile, target) {
  const base64 = fs.readFileSync(absoluteFile).toString('base64');
  const mime = absoluteFile.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  await page.setContent(`<img id="source" src="data:${mime};base64,${base64}" />`);
  const dataUrl = await page.evaluate(async () => {
    const img = document.getElementById('source');
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const width = canvas.width;
    const height = canvas.height;
    const visited = new Uint8Array(width * height);
    const queue = [];
    const nearWhite = (index) => {
      const r = data[index * 4], g = data[index * 4 + 1], b = data[index * 4 + 2];
      return Math.min(r, g, b) >= 226 && Math.max(r, g, b) - Math.min(r, g, b) <= 26;
    };
    const enqueue = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (visited[index] || !nearWhite(index)) return;
      visited[index] = 1;
      queue.push(index);
    };
    for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
    for (let y = 0; y < height; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
    while (queue.length) {
      const index = queue.pop();
      const x = index % width, y = Math.floor(index / width);
      data[index * 4 + 3] = 0;
      enqueue(x + 1, y); enqueue(x - 1, y); enqueue(x, y + 1); enqueue(x, y - 1);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const cutPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const compose = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (const product of PRODUCTS) {
    const cutFile = path.join(CUT, `${product.sku}.png`);
    if (!fs.existsSync(cutFile)) {
      console.log('cut', product.sku);
      await cutout(cutPage, path.join(ROOT, product.file), cutFile);
    }
    const productB64 = fs.readFileSync(cutFile).toString('base64');
    for (const [market, config] of Object.entries(MARKETS)) {
      const bg = fs.readFileSync(path.join(ROOT, 'public', 'images', 'aigc', config.file)).toString('base64');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{margin:0;width:1600px;height:1000px;overflow:hidden;font-family:Arial,sans-serif}
        .stage{position:relative;width:1600px;height:1000px;background-image:url(data:image/jpeg;base64,${bg});background-size:${config.backgroundSize};background-position:${config.backgroundPosition};background-repeat:no-repeat}
        .stage::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,16,12,.03),rgba(20,16,12,.18));pointer-events:none}
        .product{position:absolute;left:${product.left};top:${product.top};width:${product.width};transform:translateX(-50%) rotate(${product.rotate});filter:drop-shadow(10px 16px 15px rgba(32,24,16,.25));z-index:2}
        .product img{width:100%;display:block}
        .label{position:absolute;right:22px;bottom:20px;z-index:3;padding:9px 12px;background:rgba(20,17,13,.80);color:#f4ecdf;font-size:13px;letter-spacing:.05em;line-height:1.45;max-width:520px}
        .label strong{display:block;font-size:11px;letter-spacing:.15em;color:#e7c98d;margin-bottom:2px}
        .sku{position:absolute;left:24px;bottom:20px;z-index:3;color:#f8f1e6;text-shadow:0 1px 5px rgba(0,0,0,.55);font-size:14px;letter-spacing:.06em}
      </style></head><body><div class="stage">
        <div class="product"><img src="data:image/png;base64,${productB64}" alt=""></div>
        <div class="sku">${product.sku} · ${product.finish} · OLANG product photograph</div>
        <div class="label"><strong>CONCEPT VISUAL — NOT A PROJECT PHOTO</strong>AI bathroom atmosphere + real OLANG product photograph. Illustrative only; not to scale.</div>
      </div></body></html>`;
      await compose.setContent(html, { waitUntil: 'load' });
      await compose.waitForTimeout(200);
      const file = path.join(OUT, `product-${product.sku}-${market}.jpg`);
      await compose.screenshot({ path: file, type: 'jpeg', quality: 88 });
      console.log('wrote', file);
    }
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

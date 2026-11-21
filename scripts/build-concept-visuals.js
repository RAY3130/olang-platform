'use strict';

/**
 * Builds three clearly-labelled illustrative compositions:
 * AI-generated bathroom background + a real OLANG product photograph.
 * The product is cut out with a border-connected white-removal pass, not a
 * generative edit, so its shape and finish are not redrawn.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(ROOT, 'public', 'images', 'concepts');
const CUT = path.join(ROOT, 'public', 'images', 'concepts', 'cutouts');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CUT, { recursive: true });

const MARKETS = [
  {
    code: 'en-gb',
    background: path.join(ROOT, 'public', 'images', 'aigc', 'uk-bathroom.jpg'),
    product: path.join(ROOT, 'public', 'images', 'products', 'official', 'colors', 'OL-1208', 'brushed-gold.jpg'),
    productSku: 'OL-1208',
    finish: 'Brushed Gold',
    backgroundSize: 'cover',
    backgroundPosition: '50% 62%',
    productWidth: '33%',
    left: '55%',
    top: '28%',
    rotate: '-1deg',
  },
  {
    code: 'de',
    background: path.join(ROOT, 'public', 'images', 'aigc', 'de-bathroom.jpg'),
    product: path.join(ROOT, 'public', 'images', 'products', 'official', 'colors', 'OL-1209', 'chrome.jpg'),
    productSku: 'OL-1209',
    finish: 'Chrome',
    backgroundSize: 'cover',
    backgroundPosition: '50% 48%',
    productWidth: '34%',
    left: '33%',
    top: '31%',
    rotate: '0deg',
  },
  {
    code: 'ja-jp',
    background: path.join(ROOT, 'public', 'images', 'aigc', 'jp-bathroom.jpg'),
    product: path.join(ROOT, 'public', 'images', 'products', 'official', 'colors', 'OL-1204', 'chrome.jpg'),
    productSku: 'OL-1204',
    finish: 'Chrome',
    backgroundSize: '132%',
    backgroundPosition: '83% 58%',
    productWidth: '10%',
    left: '55%',
    top: '28%',
    rotate: '0deg',
  },
];

async function cutout(page, file, target) {
  const base64 = fs.readFileSync(file).toString('base64');
  await page.setContent(`<img id="source" src="data:image/jpeg;base64,${base64}" />`);
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
    function nearWhite(index) {
      const r = data[index * 4];
      const g = data[index * 4 + 1];
      const b = data[index * 4 + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return min >= 226 && max - min <= 26;
    }
    function enqueue(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (visited[index]) return;
      if (!nearWhite(index)) return;
      visited[index] = 1;
      queue.push(index);
    }
    for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
    for (let y = 0; y < height; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
    while (queue.length) {
      const index = queue.pop();
      const x = index % width;
      const y = Math.floor(index / width);
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
  const composePage = await browser.newPage({ viewport: { width: 1600, height: 1067 } });
  for (const market of MARKETS) {
    const cutFile = path.join(CUT, `${market.code}-${market.productSku}.png`);
    if (!fs.existsSync(cutFile)) await cutout(cutPage, market.product, cutFile);
    const background = fs.readFileSync(market.background).toString('base64');
    const product = fs.readFileSync(cutFile).toString('base64');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1600px;height:1067px;overflow:hidden;font-family:Arial,sans-serif}
      .stage{position:relative;width:1600px;height:1067px;background-image:url(data:image/jpeg;base64,${background});background-size:${market.backgroundSize};background-position:${market.backgroundPosition};background-repeat:no-repeat}
      .stage::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,16,12,.04),rgba(20,16,12,.20));pointer-events:none}
      .product{position:absolute;left:${market.left};top:${market.top};width:${market.productWidth};transform:translateX(-50%) rotate(${market.rotate});filter:drop-shadow(12px 20px 18px rgba(35,25,15,.26));z-index:2}
      .product img{width:100%;display:block}
      .label{position:absolute;right:26px;bottom:24px;z-index:3;padding:10px 14px;background:rgba(20,17,13,.78);color:#f4ecdf;font-size:14px;letter-spacing:.07em;line-height:1.45;max-width:520px}
      .label strong{display:block;font-size:12px;letter-spacing:.16em;color:#e7c98d;margin-bottom:2px}
      .sku{position:absolute;left:28px;bottom:25px;z-index:3;color:#f8f1e6;text-shadow:0 1px 5px rgba(0,0,0,.5);font-size:15px;letter-spacing:.08em}
    </style></head><body><div class="stage">
      <div class="product"><img src="data:image/png;base64,${product}" alt=""></div>
      <div class="sku">${market.productSku} · ${market.finish} · OLANG product photograph</div>
      <div class="label"><strong>ILLUSTRATIVE COMPOSITE / CONCEPT VISUAL</strong>AI-generated bathroom atmosphere with a real OLANG product photograph. Not a project installation and not to scale.</div>
    </div></body></html>`;
    await composePage.setContent(html, { waitUntil: 'load' });
    await composePage.waitForTimeout(350);
    const target = path.join(OUT, `concept-${market.code}.jpg`);
    await composePage.screenshot({ path: target, type: 'jpeg', quality: 90 });
    console.log('wrote', target);
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

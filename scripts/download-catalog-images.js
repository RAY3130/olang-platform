'use strict';

/*
 * Downloads the public product image referenced by each migrated SKU.
 * Raw files are kept outside the web root; scripts/optimize-catalog-images.ps1
 * creates the web-sized JPEGs used by the site.
 */

const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/db/catalog.json');

const OUT = path.resolve(__dirname, '..', '..', 'research', 'original_images');
fs.mkdirSync(OUT, { recursive: true });

function extension(url) {
  const match = String(url).split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

async function download(product) {
  const ext = extension(product.sourceImage);
  const target = path.join(OUT, `${product.sku.replace(/[^A-Za-z0-9-]/g, '-')}${ext}`);
  if (fs.existsSync(target) && fs.statSync(target).size > 5000) return { product, target, skipped: true };
  const url = product.sourceImage.replace(/&amp;/g, '&');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; OLANG catalogue migration)',
          referer: 'https://en.olang.cn/',
        },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) throw new Error('image too small');
      fs.writeFileSync(target, buffer);
      return { product, target, bytes: buffer.length };
    } catch (error) {
      if (attempt === 3) return { product, error: error.message };
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  return { product, error: 'unknown' };
}

(async () => {
  let cursor = 0;
  const results = [];
  async function worker() {
    while (cursor < catalog.products.length) {
      const index = cursor;
      cursor += 1;
      const result = await download(catalog.products[index]);
      results.push(result);
      if (results.length % 20 === 0) console.error(`downloaded ${results.length}/${catalog.products.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const failures = results.filter((result) => result.error);
  fs.writeFileSync(
    path.resolve(__dirname, '..', '..', 'research', 'original_images_manifest.json'),
    `${JSON.stringify(results.map((result) => ({
      sku: result.product.sku,
      sourceImage: result.product.sourceImage,
      file: result.target ? path.basename(result.target) : null,
      bytes: result.bytes || null,
      error: result.error || null,
    })), null, 2)}\n`,
  );
  console.log(JSON.stringify({ total: results.length, downloaded: results.length - failures.length, failures: failures.length }, null, 2));
  for (const failure of failures) console.log('FAIL', failure.product.sku, failure.error);
})();

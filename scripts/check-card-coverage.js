'use strict';

/**
 * Quantitative card coverage check for the v3 brief.
 *
 * The card build places the trimmed product on a 900x675 white editorial canvas with an 8 px
 * safety margin. This script finds the product bounding box in every card and compares its area
 * with the canvas area. It does not infer a product silhouette from a thresholded white
 * background: trim() gives the bounding box of non-background pixels, which is the same
 * measurable contract used by the image build.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'images', 'products', 'official', 'cards');
const OUT = path.resolve(ROOT, '..', 'deliverables', '08_presentation_localization', 'card-coverage.json');
const canvas = 900 * 675;

async function main() {
  const files = fs.readdirSync(DIR).filter((file) => file.endsWith('.jpg') && !/-400\.jpg$/.test(file)).sort();
  const rows = [];
  for (const file of files) {
    const filePath = path.join(DIR, file);
    try {
      const trimmed = await sharp(filePath).trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
      const box = trimmed.info.width * trimmed.info.height;
      const coverage = box / canvas;
      rows.push({
        sku: file.replace(/\.jpg$/, ''),
        canvas: { width: 900, height: 675 },
        productBox: { width: trimmed.info.width, height: trimmed.info.height },
        coverage: Number(coverage.toFixed(4)),
        percent: Number((coverage * 100).toFixed(1)),
        pass: coverage >= 0.55,
      });
    } catch (error) {
      rows.push({ sku: file.replace(/\.jpg$/, ''), error: error.message, pass: false });
    }
  }
  const values = rows.filter((row) => !row.error).map((row) => row.coverage).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;
  const result = {
    generated_at: new Date().toISOString(),
    contract: 'product bounding box on 900x675 card canvas; target >= 0.55, median >= 0.62',
    count: rows.length,
    pass: rows.filter((row) => row.pass).length,
    fail: rows.filter((row) => !row.pass).length,
    median: Number(median.toFixed(4)),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ count: result.count, pass: result.pass, fail: result.fail, median: result.median, out: OUT }, null, 2));
  if (result.fail > 0 || result.median < 0.62) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { DIR, OUT };

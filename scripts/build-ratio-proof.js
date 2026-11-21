'use strict';

/**
 * Build the five side-by-side proofs used in the QA record.
 *
 * Each proof puts the archived original next to the card file the grid actually serves, at the
 * same display height. If a card had been cropped or stretched the product outline would stop
 * matching at a glance, which is the point of the sheet.
 *
 * Output: deliverables/05_QA/ratio-proof/<SKU>.png plus an index.md that lists the ratios.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, '..', 'deliverables', '05_QA', 'ratio-proof');
const MANIFEST_PATH = path.join(ROOT, 'public', 'images', 'products', 'official', '_manifest.json');

const PAPER = '#f7f4ef';
const DISPLAY_HEIGHT = 620;
const GAP = 28;
const PAD = 32;

function absFromPublic(publicPath) {
  return path.join(ROOT, 'public', String(publicPath).replace(/^\/+/, ''));
}

// A fixed, deliberately varied sample: a robe hook, a towel ring, a towel bar, a corner shelf
// and the one SKU whose source is neither 1:1 nor exactly 2:1.
const SAMPLE_SKUS = ['OL-1204', 'OL-1205', 'OL-1208', 'OL-5216', 'OL-9715A'];

function pick(manifest) {
  const items = manifest.items || [];
  const bySku = new Map(items.map((item) => [item.sku, item]));
  const chosen = SAMPLE_SKUS.map((sku) => bySku.get(sku)).filter(Boolean);
  if (chosen.length >= 5) return chosen;
  const used = new Set(chosen.map((item) => item.sku));
  const fallback = items
    .filter((item) => !used.has(item.sku))
    .sort((a, b) => Math.abs(b.src.ratio - 1) - Math.abs(a.src.ratio - 1));
  return chosen.concat(fallback).slice(0, 5);
}

function labelSvg(width, height, lines) {
  const rows = lines.map((line, index) => {
    const size = index === 0 ? 22 : 17;
    const fill = index === 0 ? '#211b15' : '#5c5042';
    const y = 30 + index * 24;
    return `<text x="${PAD}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="${fill}">${line}</text>`;
  }).join('');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${PAPER}"/>
    ${rows}
  </svg>`);
}

async function buildProof(item) {
  const sourcePath = absFromPublic(item.src.path);
  const card = item.outputs.find((output) => output.role === 'card');

  const resizeTo = (inputPath) => sharp(inputPath).resize({ height: DISPLAY_HEIGHT, fit: 'inside' });

  const sourceBuf = await resizeTo(sourcePath)
    .flatten({ background: PAPER })
    .toBuffer({ resolveWithObject: true });
  const cardBuf = await resizeTo(absFromPublic(card.path))
    .flatten({ background: PAPER })
    .toBuffer({ resolveWithObject: true });

  const headerHeight = 120;
  const width = Math.max(
    sourceBuf.info.width + cardBuf.info.width + GAP * 3,
    700,
  );
  const height = headerHeight + Math.max(sourceBuf.info.height, cardBuf.info.height) + PAD;

  const caption = labelSvg(width, headerHeight, [
    `${item.sku} — source ${item.src.width} × ${item.src.height} px · ratio ${item.src.ratio.toFixed(4)}`,
    `left = archived original · right = card file ${card.width} × ${card.height} px · ratio ${card.ratio.toFixed(4)}`,
    `difference ${Math.abs((card.ratio - item.src.ratio) / item.src.ratio * 100).toFixed(4)}% · tolerance 0.5%`,
  ]);

  const left = Math.round((width - sourceBuf.info.width - cardBuf.info.width - GAP) / 2);

  const outPath = path.join(OUT_DIR, `${item.sku}.png`);
  await sharp({
    create: { width, height, channels: 3, background: PAPER },
  })
    .composite([
      { input: caption, left: 0, top: 0 },
      { input: sourceBuf.data, left, top: headerHeight },
      { input: cardBuf.data, left: left + sourceBuf.info.width + GAP, top: headerHeight },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return {
    sku: item.sku,
    file: path.basename(outPath),
    source: `${item.src.width} × ${item.src.height}`,
    card: `${card.width} × ${card.height}`,
    sourceRatio: item.src.ratio,
    cardRatio: card.ratio,
    driftPercent: Number((Math.abs((card.ratio - item.src.ratio) / item.src.ratio) * 100).toFixed(4)),
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const chosen = pick(manifest);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rows = [];
  for (const item of chosen) rows.push(await buildProof(item));

  const index = [
    '# Ratio proof — five SKUs, original against card file',
    '',
    `Generated ${new Date().toISOString()} by \`platform/scripts/build-ratio-proof.js\`.`,
    'Each image shows the archived original on the left and the card file the grid serves on the right,',
    'scaled to the same display height. A crop or a stretch would break the outline match immediately.',
    '',
    '| SKU | Source px | Card px | Source ratio | Card ratio | Drift |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.sku} | ${row.source} | ${row.card} | ${row.sourceRatio.toFixed(4)} | ${row.cardRatio.toFixed(4)} | ${row.driftPercent}% |`),
    '',
    'Threshold: 0.5%. Machine check: `node platform/scripts/check-image-ratios.js`.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'index.md'), index, 'utf8');

  console.log(JSON.stringify({ generated: rows.length, rows }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { pick };

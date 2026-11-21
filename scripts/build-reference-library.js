'use strict';

/**
 * Build the local reference-image library used by the three market editions.
 *
 * Source photographs were captured for the classroom demonstration from public brand pages
 * (Croydex / KEUCO / TOTO); the originals are kept under research/reference_bathrooms/candidates.
 * This script only crops and resizes those source photographs. It does not add products, logos
 * or AI-generated content. credits.json records the provenance of every output.
 *
 * Usage: node scripts/build-reference-library.js
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.resolve(ROOT, '..', 'research', 'reference_bathrooms', 'candidates');
const OUT = path.join(ROOT, 'public', 'images', 'reference');
const WIDTH = 1600;
const HEIGHT = 1000;
const CAPTURED = '2026-11-17';

const SOURCES = {
  'en-gb': [
    { file: 'croydex-hero-01', source: 'croydex_deepblue_large.jpg', width: 1600, height: 1067, brand: 'Croydex', kind: 'hero', page: 'https://www.croydex.co.uk/', image: 'https://www.croydex.co.uk/media/wysiwyg/Deep_Blue_Tones_Bathroom_Inspiration_01.jpg', alt: 'Bathroom reference, UK — deep blue wall tiles and freestanding bath' },
    { file: 'croydex-style-01', source: 'croydex_family.jpg', brand: 'Croydex', kind: 'style', page: 'https://www.croydex.co.uk/', image: 'https://www.insightdiy.co.uk/live/news/wysiwyg/Croydex%20Family%20Bathroom%20725.jpg', alt: 'Bathroom reference, UK — family bathroom with blue vanity' },
    { file: 'croydex-style-02', source: 'croydex_chetsford.jpg', brand: 'Croydex', kind: 'style', page: 'https://www.croydex.co.uk/', image: 'https://www.goodhomesmagazine.com/wp-content/uploads/2018/08/Croydex_Chetsford_lifestyle_bathroom_luxury_goodhomes.jpg', alt: 'Bathroom reference, UK — classic freestanding bath and vanity' },
    { file: 'croydex-style-03', source: 'croydex_illuminated_large.jpg', brand: 'Croydex', kind: 'style', page: 'https://www.croydex.co.uk/', image: 'https://www.croydex.co.uk/media/wysiwyg/Illuminated-Mirrors-Bathroom-Inspiration-hp-banner.jpg', alt: 'Bathroom reference, UK — dark bathroom with illuminated mirrors' },
    { file: 'croydex-detail-01', source: 'croydex_deepblue_large.jpg', brand: 'Croydex', kind: 'detail', crop: [0.04, 0.20, 0.36, 0.55], alt: 'Reference detail, UK — basin, brass accessories and blue tile' },
    { file: 'croydex-detail-02', source: 'croydex_family.jpg', brand: 'Croydex', kind: 'detail', crop: [0.44, 0.32, 0.42, 0.48], alt: 'Reference detail, UK — vanity, mirror and towel ring' },
    { file: 'croydex-detail-03', source: 'croydex_chetsford.jpg', brand: 'Croydex', kind: 'detail', crop: [0.52, 0.20, 0.38, 0.52], alt: 'Reference detail, UK — traditional vanity and brass tap' },
    { file: 'croydex-install-01', source: 'croydex_family.jpg', brand: 'Croydex', kind: 'install', crop: [0.58, 0.30, 0.38, 0.52], alt: 'Reference installation detail, UK — wall-mounted shower and rail' },
  ],
  'de-de': [
    { file: 'keuco-hero-01', source: 'keuco_lignatur.jpg', brand: 'KEUCO', kind: 'hero', page: 'https://www.keuco.com/de_de/', image: 'https://keuco.scene7.com/is/image/keuco/KEUCO_Lignatur_ART_001_shortcut-AVS', alt: 'Bathroom reference, DE — concrete bathroom with oak vanity' },
    { file: 'keuco-style-01', source: 'keuco_royal.jpg', brand: 'KEUCO', kind: 'style', page: 'https://www.keuco.com/de_de/', image: 'https://keuco.scene7.com/is/image/keuco/2117_KEU_Royal_Lumos_Content_2023_Three_FHD-AVS', alt: 'Bathroom reference, DE — illuminated mirror in a quiet bathroom' },
    { file: 'keuco-style-02', source: 'keuco_6738.jpg', brand: 'KEUCO', kind: 'style', page: 'https://www.keuco.com/de_de/', image: 'https://keuco.scene7.com/is/image/keuco/6738_06_01%3A1-1-Square', alt: 'Bathroom reference, DE — dark stone bathroom with backlit mirror' },
    { file: 'keuco-style-03', source: 'keuco_6228.jpg', brand: 'KEUCO', kind: 'style', page: 'https://www.keuco.com/de_de/', image: 'https://keuco.scene7.com/is/image/keuco/6228_01_01:1-1-Square', alt: 'Bathroom reference, DE — large bathroom with twin basins' },
    { file: 'keuco-style-04', source: 'keuco_somaris.jpg', brand: 'KEUCO', kind: 'style', page: 'https://www.keuco.com/de_de/', image: 'https://keuco.scene7.com/is/image/keuco/2232_KEU_Somaris_Cont02_2023_0320b_2T_800mm_interior_rueckwand_eiche:1-1-Square', alt: 'Bathroom reference, DE — mirror cabinet detail' },
    { file: 'keuco-detail-01', source: 'keuco_lignatur.jpg', brand: 'KEUCO', kind: 'detail', crop: [0.20, 0.26, 0.60, 0.56], alt: 'Reference detail, DE — oak vanity and mirror' },
    { file: 'keuco-detail-02', source: 'keuco_6738.jpg', brand: 'KEUCO', kind: 'detail', crop: [0.18, 0.22, 0.56, 0.55], alt: 'Reference detail, DE — backlit mirror and brass fittings' },
    { file: 'keuco-install-01', source: 'keuco_6228.jpg', brand: 'KEUCO', kind: 'install', crop: [0.08, 0.35, 0.54, 0.52], alt: 'Reference installation detail, DE — twin-basin wall fixing' },
  ],
  'ja-jp': [
    { file: 'toto-hero-01', source: 'toto_bath_0.jpg', brand: 'TOTO', kind: 'hero', page: 'https://jp.toto.com/products/bath/', image: 'https://toto.imagewave.pictures/04502506G012-web614-250718.jpg', alt: 'Bathroom reference, JP — wood-lined bathroom with deep soaking tub' },
    { file: 'toto-style-01', source: 'toto_cand_1.jpg', brand: 'TOTO', kind: 'style', page: 'https://jp.toto.com/reform/case/view/163616/?tab=2', image: 'https://reform.jp.toto.com/webapp/data/images/case/0/7040/163616/2/after_image1.jpg', alt: 'Bathroom reference, JP — compact unit bathroom' },
    { file: 'toto-style-02', source: 'toto_cand_3.jpg', brand: 'TOTO', kind: 'style', page: 'https://jp.toto.com/reform/case/view/163616/?tab=2', image: 'https://reform.jp.toto.com/webapp/data/images/case/0/7040/163616/2/after_image1.jpg', alt: 'Bathroom reference, JP — blue-tiled bathroom with tub' },
    { file: 'toto-style-03', source: 'toto_case_163616.jpg', brand: 'TOTO', kind: 'style', page: 'https://jp.toto.com/reform/case/view/163616/?tab=2', image: 'https://reform.jp.toto.com/webapp/data/images/case/0/7040/163616/2/after_image1.jpg', alt: 'Bathroom reference, JP — modern unit bath with shower' },
    { file: 'toto-detail-01', source: 'toto_bath_0.jpg', brand: 'TOTO', kind: 'detail', crop: [0.08, 0.12, 0.58, 0.70], alt: 'Reference detail, JP — deep tub and timber deck' },
    { file: 'toto-detail-02', source: 'toto_cand_3.jpg', brand: 'TOTO', kind: 'detail', crop: [0.40, 0.08, 0.56, 0.62], alt: 'Reference detail, JP — shower and wall controls' },
    { file: 'toto-detail-03', source: 'toto_cand_1.jpg', brand: 'TOTO', kind: 'detail', crop: [0.03, 0.36, 0.55, 0.58], alt: 'Reference detail, JP — bath and window' },
    { file: 'toto-install-01', source: 'toto_bath_0.jpg', brand: 'TOTO', kind: 'install', crop: [0.42, 0.08, 0.52, 0.72], alt: 'Reference installation detail, JP — wall shelf and shower' },
  ],
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function render(sourcePath, item, outputPath) {
  let pipeline = sharp(sourcePath, { failOn: 'none' }).rotate();
  if (item.crop) {
    const meta = await pipeline.metadata();
    const [x, y, w, h] = item.crop;
    pipeline = sharp(sourcePath, { failOn: 'none' }).rotate().extract({
      left: Math.round(meta.width * x), top: Math.round(meta.height * y),
      width: Math.round(meta.width * w), height: Math.round(meta.height * h),
    });
  }
  const width = item.width || WIDTH;
  const height = item.height || HEIGHT;
  const buffer = await pipeline
    .resize({ width, height, fit: 'cover', position: 'center' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(outputPath, buffer);
  return { buffer, sha256: sha256(buffer) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const credits = [];
  for (const [market, items] of Object.entries(SOURCES)) {
    const marketDir = path.join(OUT, market);
    fs.mkdirSync(marketDir, { recursive: true });
    for (const item of items) {
      const sourcePath = path.join(SOURCE, item.source);
      if (!fs.existsSync(sourcePath)) throw new Error(`missing source: ${sourcePath}`);
      const jpg = path.join(marketDir, `${item.file}.jpg`);
      const webp = path.join(marketDir, `${item.file}.webp`);
      const { buffer } = await render(sourcePath, item, jpg);
      await sharp(buffer).webp({ quality: 82, effort: 5 }).toFile(webp);
      const meta = await sharp(jpg).metadata();
      credits.push({
        file: `/images/reference/${market}/${item.file}.jpg`,
        webp: `/images/reference/${market}/${item.file}.webp`,
        market,
        brand: item.brand,
        kind: item.kind,
        alt: item.alt,
        sourcePage: item.page,
        sourceImage: item.image,
        capturedAt: CAPTURED,
        width: meta.width,
        height: meta.height,
        sha256: sha256(buffer),
        usage: 'Market presentation reference; not an OLANG project or installation.',
      });
      console.log(`${market}/${item.file} ${meta.width}x${meta.height}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'Reference images from public brand pages for classroom market presentation. They are not OLANG projects or installations. Rights remain with the brands.',
    images: credits,
  }, null, 2));
  console.log(`wrote ${credits.length} reference images and credits.json`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { SOURCES, OUT };

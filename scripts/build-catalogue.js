'use strict';

/**
 * Build the English catalogue PDF: the one downloadable document the site promises.
 *
 * Every number in this file is read from the database or from a published OLANG page. The
 * factory area and the export-country count come from OLANG's public home page
 * ("over 5,000 square meters", "sold in over 30 countries and regions"); the founding year comes
 * from the published company timeline. Nothing is estimated.
 *
 * Output: public/downloads/olang-catalogue-2026.pdf
 * Usage:  node scripts/build-catalogue.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'downloads');
const OUT_PATH = path.join(OUT_DIR, 'olang-catalogue-2026.pdf');

function loadPdfKit() {
  try {
    return require('pdfkit');
  } catch (_) {
    const fallback = path.resolve(ROOT, '..', 'tools', 'docgen', 'node_modules', 'pdfkit');
    return require(fallback);
  }
}

const PDFDocument = loadPdfKit();

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, points
const MARGIN = 48;
const INK = '#1d1a16';
const BRASS = '#8b6a37';
const MUTED = '#6f6455';
const PAPER = '#f7f4ef';
const LINE = '#d9d0c2';

function cardPath(sku) {
  return path.join(ROOT, 'public', 'images', 'products', 'official', 'cards', `${sku}.jpg`);
}

function collect() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'storage', 'olang.sqlite'), { readOnly: true });

  const totals = {
    products: db.prepare('SELECT COUNT(*) c FROM products WHERE published = 1').get().c,
    categories: db.prepare('SELECT COUNT(*) c FROM categories WHERE published = 1').get().c,
    series: db.prepare("SELECT COUNT(DISTINCT series) c FROM products WHERE published = 1 AND series IS NOT NULL AND TRIM(series) <> ''").get().c,
    finishes: db.prepare('SELECT COUNT(*) c FROM official_colors').get().c,
  };

  const categories = db.prepare(`
    SELECT c.id, c.key, c.slug,
           COALESCE(ct.name, cte.name) AS name,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.published = 1) AS count
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'en'
    LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
    WHERE c.published = 1
    ORDER BY c.sort_order, c.id
  `).all();

  const repStatement = db.prepare(`
    SELECT p.sku, p.slug, p.series,
           (SELECT value FROM product_attributes a WHERE a.product_id = p.id AND a.attr_key = 'dimensions') AS dimensions,
           (SELECT value FROM product_attributes a WHERE a.product_id = p.id AND a.attr_key = 'material') AS material,
           (SELECT COALESCE(pt.name, p.sku) FROM product_translations pt WHERE pt.product_id = p.id AND pt.locale = 'en') AS name,
           (SELECT COUNT(*) FROM product_colors pc WHERE pc.product_id = p.id) AS color_count,
           (SELECT COUNT(*) FROM product_colors pc JOIN product_color_images pci ON pci.product_id = pc.product_id WHERE pc.product_id = p.id) AS photo_count
    FROM products p
    WHERE p.published = 1 AND p.category_id = ?
    ORDER BY (SELECT COUNT(*) FROM product_color_images pci WHERE pci.product_id = p.id) DESC, p.sort_order, p.id
    LIMIT 1
  `);

  const finishes = db.prepare('SELECT display_label FROM official_colors ORDER BY id').all().map((row) => row.display_label);

  const perCategory = categories.map((category) => {
    const rep = repStatement.get(category.id);
    let colors = [];
    if (rep) {
      colors = db.prepare(`
        SELECT oc.display_label FROM product_colors pc
        JOIN official_colors oc ON oc.id = pc.color_id
        JOIN products p ON p.id = pc.product_id
        WHERE p.sku = ? ORDER BY pc.sort_order, oc.id
      `).all(rep.sku).map((row) => row.display_label);
    }
    return { ...category, rep, colors };
  });

  const moq = db.prepare("SELECT value FROM product_attributes WHERE attr_key = 'moq' AND value IS NOT NULL ORDER BY id LIMIT 1").get();
  const lead = db.prepare("SELECT value FROM product_attributes WHERE attr_key = 'lead_time' AND value IS NOT NULL ORDER BY id LIMIT 1").get();
  const packing = db.prepare("SELECT value FROM product_attributes WHERE attr_key = 'packaging' AND value IS NOT NULL ORDER BY id LIMIT 1").get();

  db.close();
  return { totals, perCategory, finishes, framework: { moq: moq && moq.value, lead: lead && lead.value, packing: packing && packing.value } };
}

function rule(doc, y) {
  doc.save().moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.7).strokeColor(LINE).stroke().restore();
}

function contentPage(doc, data, index) {
  doc.addPage();
  doc.rect(0, 0, PAGE.width, PAGE.height).fill('#ffffff');

  doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text('OLANG · 2026 CATALOGUE', MARGIN, MARGIN, { characterSpacing: 1.4 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${String(index).padStart(2, '0')} / ${String(data.perCategory.length + 4).padStart(2, '0')}`, PAGE.width - MARGIN - 60, MARGIN, { width: 60, align: 'right' });
  rule(doc, MARGIN + 16);

  let y = MARGIN + 40;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(24).text(data.category.name, MARGIN, y, { width: PAGE.width - MARGIN * 2 });
  y = doc.y + 6;
  doc.fillColor(MUTED).font('Helvetica').fontSize(10)
    .text(`${data.category.count} models in this category`, MARGIN, y)
    .text(`${data.totals.series} series overall`, MARGIN, doc.y + 2);
  y = doc.y + 18;

  const image = data.category.rep ? cardPath(data.category.rep.sku) : null;
  const boxWidth = PAGE.width - MARGIN * 2;
  const boxHeight = 250;
  doc.save().rect(MARGIN, y, boxWidth, boxHeight).fill(PAPER).restore();
  if (image && fs.existsSync(image)) {
    // contain: the card keeps its own aspect ratio inside the frame, never cropped or stretched.
    doc.image(image, MARGIN + 12, y + 12, { fit: [boxWidth - 24, boxHeight - 24], align: 'center', valign: 'center' });
  }
  y += boxHeight + 18;

  const rep = data.category.rep;
  if (rep) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`${rep.name} · ${rep.sku}`, MARGIN, y);
    y = doc.y + 4;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    const rows = [
      ['Series', rep.series || '—'],
      ['Material', rep.material || 'Released with the specification sheet'],
      ['Dimensions', rep.dimensions || 'Released with the specification sheet'],
      ['Finishes', data.category.colors.length ? data.category.colors.join(' · ') : 'Released with the quotation'],
      ['Finish photographs', rep.photo_count ? `${rep.photo_count} of ${rep.color_count} finishes` : 'Finish samples on request'],
    ];
    for (const [label, value] of rows) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), MARGIN, y, { characterSpacing: 0.8 });
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(String(value), MARGIN + 110, y - 1, { width: boxWidth - 110 });
      y = Math.max(doc.y, y + 14) + 4;
    }
  }

  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5)
    .text('Representative model. Dimensions and finishes are confirmed for the exact SKU on the specification sheet.', MARGIN, PAGE.height - MARGIN - 10, { width: boxWidth });
}

function main() {
  const data = collect();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: {
    Title: 'OLANG 2026 Catalogue — brass bathroom hardware',
    Author: 'OLANG (Foshan Langhao Hardware)',
    Subject: 'Public product directory; technical values available on request',
    Keywords: 'brass bathroom hardware, robe hooks, towel bars, OEM, ODM, MOQ',
  } });
  const stream = fs.createWriteStream(OUT_PATH);
  doc.pipe(stream);

  // ---- Cover
  doc.addPage();
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(PAPER);
  doc.rect(0, 0, 10, PAGE.height).fill(BRASS);
  doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(10).text('OLANG', MARGIN + 16, 110, { characterSpacing: 3 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(40).text('Bathroom hardware', MARGIN + 16, 140, { width: PAGE.width - 120 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(40).text('catalogue 2026', MARGIN + 16, 190, { width: PAGE.width - 120 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text(
    `${data.totals.products} published models · ${data.totals.categories} categories · ${data.totals.series} series`,
    MARGIN + 16, 252, { width: PAGE.width - 140 },
  );

  const facts = [
    ['Founded', '2003, Foshan'],
    ['Production base', 'Chancheng District, over 5,000 m²'],
    ['Export', 'Sold in over 30 countries and regions'],
    ['Finishes', `${data.totals.finishes} published surface finishes`],
  ];
  let fy = 320;
  for (const [label, value] of facts) {
    doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), MARGIN + 16, fy, { characterSpacing: 1 });
    doc.fillColor(INK).font('Helvetica').fontSize(12).text(value, MARGIN + 16, fy + 13, { width: PAGE.width - 140 });
    fy += 46;
  }

  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(
    'Foshan Langhao Hardware (OLANG) · master@olang.cn · +86 757 8539 4277',
    MARGIN + 16, PAGE.height - 90, { width: PAGE.width - 140 },
  );
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text(
    'Company figures follow the public OLANG company profile. Product values are confirmed for the exact SKU on the specification sheet.',
    MARGIN + 16, PAGE.height - 64, { width: PAGE.width - 140 },
  );

  // ---- Company
  doc.addPage();
  doc.rect(0, 0, PAGE.width, PAGE.height).fill('#ffffff');
  doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text('COMPANY', MARGIN, MARGIN, { characterSpacing: 1.4 });
  rule(doc, MARGIN + 16);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(24).text('A Foshan manufacturer of brass bathroom hardware', MARGIN, MARGIN + 40, { width: PAGE.width - MARGIN * 2 });

  const company = [
    ['Founded', '2003'],
    ['Location', 'Chancheng District, Foshan, Guangdong — the hardware manufacturing cluster of China'],
    ['Production base', 'Over 5,000 m², precision CNC machining and in-house testing equipment'],
    ['Materials', 'Brass-led bathroom hardware range; material grades are confirmed per SKU'],
    ['Range', `${data.totals.products} models across ${data.totals.categories} categories and ${data.totals.series} series`],
    ['Export', 'Products sold in over 30 countries and regions'],
    ['Support', 'OEM and ODM: finish, logo, packaging and dimensions per project'],
  ];
  let cy = MARGIN + 110;
  for (const [label, value] of company) {
    doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), MARGIN, cy, { width: 110, characterSpacing: 0.8 });
    doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(value, MARGIN + 118, cy - 1, { width: PAGE.width - MARGIN * 2 - 118 });
    cy = Math.max(doc.y, cy + 16) + 12;
  }
  rule(doc, cy + 4);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(
    'This directory reproduces the public model, category, series and finish record. Dimensions, material grade, installation, packing, MOQ, lead time and compliance evidence are not published here; request them for the exact SKU.',
    MARGIN, cy + 18, { width: PAGE.width - MARGIN * 2 },
  );

  // ---- Eleven category pages
  data.perCategory.forEach((category, index) => contentPage(doc, { ...data, category }, index + 1));

  // ---- Ordering framework
  doc.addPage();
  doc.rect(0, 0, PAGE.width, PAGE.height).fill('#ffffff');
  doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text('ORDERING', MARGIN, MARGIN, { characterSpacing: 1.4 });
  rule(doc, MARGIN + 16);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(24).text('Quotation, MOQ and lead time', MARGIN, MARGIN + 40, { width: PAGE.width - MARGIN * 2 });

  const framework = [
    ['Minimum order', data.framework.moq || 'Confirmed for the SKU and order mix'],
    ['Lead time', data.framework.lead || 'Confirmed after specification review'],
    ['Packing', data.framework.packing || 'Confirmed against the order'],
    ['Incoterms', 'FOB, CIF or DDP quoted for the destination'],
    ['Sampling', 'Finish samples released with the quotation'],
    ['Documents', 'Specification sheet, test reports and drawings released per SKU'],
  ];
  let oy = MARGIN + 110;
  for (const [label, value] of framework) {
    doc.fillColor(BRASS).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), MARGIN, oy, { width: 120, characterSpacing: 0.8 });
    doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(String(value), MARGIN + 128, oy - 1, { width: PAGE.width - MARGIN * 2 - 128 });
    oy = Math.max(doc.y, oy + 16) + 14;
  }

  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Published finishes', MARGIN, oy + 10);
  doc.fillColor(INK).font('Helvetica').fontSize(10).text(data.finishes.join(' · '), MARGIN, doc.y + 6, { width: PAGE.width - MARGIN * 2 });

  // ---- Contact
  rule(doc, PAGE.height - 190);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text('Contact OLANG', MARGIN, PAGE.height - 168);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10);
  const contact = [
    'Foshan Langhao Hardware (OLANG)',
    'Chancheng District, Foshan, Guangdong, China',
    'master@olang.cn · +86 757 8539 4277',
    'https://en.olang.cn/',
  ];
  let ky = doc.y + 6;
  for (const line of contact) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(line, MARGIN, ky, { width: PAGE.width - MARGIN * 2 });
    ky += 16;
  }
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text(
    `Catalogue generated ${new Date().toISOString().slice(0, 10)} from the OLANG product database. Values marked as released with the quotation are confirmed for the SKU you order.`,
    MARGIN, PAGE.height - 70, { width: PAGE.width - MARGIN * 2 },
  );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ path: OUT_PATH, bytes: fs.statSync(OUT_PATH).size, pages: data.perCategory.length + 3, totals: data.totals }));
    stream.on('error', reject);
  });
}

if (require.main === module) {
  main().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, collect };

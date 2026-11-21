'use strict';

/**
 * Minimal, dependency-free PDF writer used for the demonstration demo documents.
 *
 * The files are deliberately small and contain only ASCII text so they can be opened by any
 * PDF reader. They are demo documents: the specification values come from
 * src/data/demo-spec.js and the footer says so.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');

function ascii(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdf(value) {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(value, max = 78) {
  const words = ascii(value).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pdfBuffer(title, lines) {
  const commands = [];
  let y = 800;
  commands.push('BT /F1 18 Tf 50 820 Td (' + escapePdf(title) + ') Tj ET');
  y = 780;
  for (const raw of lines) {
    for (const line of wrap(raw)) {
      if (y < 70) break;
      commands.push('BT /F1 10 Tf 50 ' + y + ' Td (' + escapePdf(line) + ') Tj ET');
      y -= 17;
    }
  }
  commands.push('BT /F1 8 Tf 50 45 Td (' + escapePdf('Demonstration demo document - representative values, not a signed engineering release.') + ') Tj ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function documentContent(product, type, specs) {
  const base = [
    `Product: ${product.sku} ${product.name}`,
    `Category: ${product.category_name}`,
    `Series: ${product.series || 'Engineering Hardware'}`,
    `Surface finishes: ${product.finishes}`,
  ];
  if (type === 'spec_sheet') {
    return [
      'SPECIFICATION SHEET',
      ...base,
      '',
      `Dimensions: ${specs.dimensions}`,
      `Net weight: ${specs.weight}`,
      `Material: ${specs.material}`,
      `Installation: ${specs.installation}`,
      `Application: ${specs.applicable_environment}`,
      `Included parts: ${specs.included_accessories}`,
      `MOQ: ${specs.moq}`,
      `Lead time: ${specs.lead_time}`,
      `Warranty: ${specs.warranty}`,
      `Certification/testing: ${specs.certification}`,
      '',
      'Dimensions are representative demonstration values and are confirmed for the exact SKU, finish and order before production.',
    ];
  }
  if (type === 'installation') {
    return [
      'INSTALLATION GUIDE',
      ...base,
      '',
      `Fixing: ${specs.installation}`,
      `Included: ${specs.included_accessories}`,
      '',
      'Before installation:',
      '1. Check the wall substrate and load capacity for the intended application.',
      '2. Mark the fixing points using the supplied template; keep the product level.',
      '3. Use the fixing kit appropriate for the substrate; do not substitute undimensioned anchors.',
      '4. Tighten the concealed screws, fit the cover plate and check the product is secure.',
      '5. Protect the finish during tiling and cleaning; use a soft cloth and pH-neutral cleaner.',
      '',
      'For grab bars, confirm the load-rated substrate and project-specific fixing before installation.',
    ];
  }
  return [
    'PACKAGING INFORMATION',
    ...base,
    '',
    `Inner box: ${specs.inner_box}`,
    `Master carton: ${specs.master_carton}`,
    `Packaging: ${specs.packaging}`,
    `MOQ: ${specs.moq}`,
    `Lead time: ${specs.lead_time}`,
    '',
    'Carton marks, mixed-SKU packing and palletisation are confirmed with the order.',
    'Each unit is protected with a soft bag and the finish is inspected before packing.',
  ];
}

function ensureDemoDocuments(db) {
  const products = db.prepare(`
    SELECT p.id, p.sku, p.series,
           COALESCE(pt.name, pte.name) AS name,
           c.key AS category_key, c.slug AS category_slug,
           COALESCE(ct.name, cte.name) AS category_name
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'en'
    LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'en'
    LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
    WHERE p.published = 1
    ORDER BY p.sku
  `).all();
  const root = path.resolve(config.uploadDir, 'demo-docs');
  fs.mkdirSync(root, { recursive: true });
  const result = { products: products.length, files: 0, updated: 0, skipped: 0 };
  const docs = ['spec_sheet', 'installation', 'packaging'];
  for (const product of products) {
    const attrs = db.prepare(`SELECT attr_key, value FROM product_attributes WHERE product_id = ?`).all(product.id);
    const map = Object.fromEntries(attrs.map((row) => [row.attr_key, row.value || '']));
    const spec = {
      dimensions: map.dimensions || 'Representative dimensions supplied with quotation',
      weight: map.weight || 'Representative weight supplied with quotation',
      material: map.material || 'Brass, grade confirmed with quotation',
      installation: map.installation || 'Wall-mounted, fixing confirmed with quotation',
      applicable_environment: map.applicable_environment || 'Bathroom and washroom applications',
      included_accessories: map.included_accessories || 'Fixing kit confirmed with quotation',
      moq: map.moq || 'Confirmed with quotation',
      lead_time: map.lead_time || 'Confirmed with quotation',
      warranty: map.warranty || '5 years',
      certification: map.certification || 'Project documentation supplied on request',
      inner_box: map.inner_box || 'Confirmed with quotation',
      master_carton: map.master_carton || 'Confirmed with quotation',
      packaging: map.packaging || 'Confirmed with quotation',
    };
    const finishes = db.prepare(`
      SELECT oc.display_label FROM product_colors pc JOIN official_colors oc ON oc.id = pc.color_id
      WHERE pc.product_id = ? ORDER BY pc.sort_order, oc.id
    `).all(product.id).map((row) => row.display_label).filter(Boolean).join(' / ') || 'Confirmed with quotation';
    const productForDoc = { ...product, finishes };
    const productDir = path.join(root, product.sku);
    fs.mkdirSync(productDir, { recursive: true });
    for (const type of docs) {
      const buffer = pdfBuffer(`${product.sku} ${type.replace('_', ' ').toUpperCase()}`, documentContent(productForDoc, type, spec));
      const filename = `${product.sku}-${type}.pdf`;
      const absolute = path.join(productDir, filename);
      fs.writeFileSync(absolute, buffer);
      result.files += 1;
      const rel = path.relative(path.resolve(config.uploadDir), absolute).split(path.sep).join('/');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const row = db.prepare('SELECT id FROM documents WHERE product_id = ? AND doc_type = ? ORDER BY id LIMIT 1')
        .get(product.id, type);
      if (row) {
        db.prepare(`
          UPDATE documents SET file_path = ?, original_name = ?, mime_type = 'application/pdf',
            size_bytes = ?, sha256 = ?, version = '1.0', language = 'en',
            markets = '["global"]', visibility = 'public', status = 'available',
            notes = 'Demonstration demo document with representative values.', updated_at = ?
          WHERE id = ?
        `).run(rel, filename, buffer.length, hash, new Date().toISOString(), row.id);
        result.updated += 1;
      } else {
        db.prepare(`
          INSERT INTO documents (title, doc_type, product_id, category_id, version, language, markets,
            visibility, status, file_path, original_name, mime_type, size_bytes, sha256, notes, created_at, updated_at)
          VALUES (?, ?, ?, NULL, '1.0', 'en', '["global"]', 'public', 'available', ?, ?, 'application/pdf', ?, ?,
            'Demonstration demo document with representative values.', ?, ?)
        `).run(`${product.sku} ${type.replace('_', ' ')}`, type, product.id, rel, filename,
          buffer.length, hash, new Date().toISOString(), new Date().toISOString());
        result.updated += 1;
      }
    }
  }
  return result;
}

module.exports = { ensureDemoDocuments, pdfBuffer };

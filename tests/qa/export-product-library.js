'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const DB = path.join(ROOT, 'storage', 'olang.sqlite');
const OUT = path.resolve(ROOT, '..', 'deliverables', '03_Product_Library');
fs.mkdirSync(OUT, { recursive: true });
const db = new DatabaseSync(DB, { readOnly: true });

const products = db.prepare(`
  SELECT p.id, p.sku, p.slug, p.series, p.collection, p.image_path, p.source_url,
         p.source_checked_at, p.source_note, p.published,
         c.key AS category_key,
         en.name AS name_en, de.name AS name_de, ja.name AS name_ja,
         en.short_description AS short_en, de.short_description AS short_de,
         ja.short_description AS short_ja,
         en.seo_title AS seo_title_en, de.seo_title AS seo_title_de, ja.seo_title AS seo_title_ja,
         en.translation_status AS translation_status_en,
         de.translation_status AS translation_status_de,
         ja.translation_status AS translation_status_ja
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN product_translations en ON en.product_id = p.id AND en.locale = 'en'
  LEFT JOIN product_translations de ON de.product_id = p.id AND de.locale = 'de'
  LEFT JOIN product_translations ja ON ja.product_id = p.id AND ja.locale = 'ja'
  WHERE p.published = 1
  ORDER BY c.sort_order, p.sort_order, p.id
`).all();

const attrs = db.prepare(`
  SELECT attr_key, value, status, source_note, data_source, visible_frontend
  FROM product_attributes WHERE product_id = ? ORDER BY sort_order, attr_key
`);
const colors = db.prepare(`
  SELECT oc.official_label, oc.display_label, pci.local_path AS photo_path, pci.source_page AS photo_source
  FROM product_colors pc
  JOIN official_colors oc ON oc.id = pc.color_id
  LEFT JOIN product_color_images pci ON pci.product_id = pc.product_id AND pci.official_label = oc.official_label
  WHERE pc.product_id = ? ORDER BY pc.sort_order, oc.id
`);

const rows = products.map((product) => {
  const attributes = attrs.all(product.id);
  const byKey = Object.fromEntries(attributes.map((attr) => [attr.attr_key, attr]));
  const finishes = colors.all(product.id);
  return {
    sku: product.sku,
    slug: product.slug,
    category_key: product.category_key,
    name: { en: product.name_en, de: product.name_de, ja: product.name_ja },
    series: product.series || '',
    collection: product.collection || '',
    source: {
      url: product.source_url,
      checked_at: product.source_checked_at,
      note: product.source_note,
      official_company_page: true,
      third_party: false,
    },
    image: {
      local_path: product.image_path ? `/${product.image_path.replace(/^\/+/, '')}` : '',
      official: true,
    },
    finishes: finishes.map((finish) => ({
      official_label: finish.official_label,
      display_label: finish.display_label,
      photo_path: finish.photo_path || '',
      photo_source: finish.photo_source || '',
      photo_available: Boolean(finish.photo_path),
    })),
    fields: attributes.map((attr) => ({
      key: attr.attr_key,
      value: attr.value,
      status: attr.status,
      source_note: attr.source_note,
      visible: Boolean(attr.visible_frontend),
    })),
    confirmed: {
      model: true,
      category: true,
      series: Boolean(product.series),
      official_photograph: true,
      finish_names: finishes.length > 0,
      material_grade: false,
      dimensions: false,
      installation: false,
      packaging: false,
      moq: false,
      lead_time: false,
      price: false,
      product_certificate: false,
    },
    public_status: {
      material: byKey.material ? byKey.material.status : 'available_on_request',
      dimensions: byKey.dimensions ? byKey.dimensions.status : 'available_on_request',
      finish: byKey.finish ? byKey.finish.status : 'available_on_request',
      moq: byKey.moq ? byKey.moq.status : 'available_on_request',
      lead_time: byKey.lead_time ? byKey.lead_time.status : 'available_on_request',
      certification: byKey.certification ? byKey.certification.status : 'pending_verification',
      customization: byKey.customization ? byKey.customization.status : 'available_on_request',
    },
    translation_status: {
      en: product.translation_status_en,
      de: product.translation_status_de,
      ja: product.translation_status_ja,
    },
    needs_company_confirmation: true,
  };
});

fs.writeFileSync(path.join(OUT, 'product_library.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'OLANG public catalogue pages plus this project database',
  truth_rules: [
    'Only model, category, series, official photograph and published finish names are treated as confirmed product facts.',
    'Material is a company-range description; the grade is not confirmed for individual SKUs.',
    'Dimensions, material grade, installation, packing, MOQ, lead time, price and product-level certification are not published and are marked available_on_request/pending_verification.',
    'No third-party platform data is merged into an OLANG SKU record.',
  ],
  count: rows.length,
  products: rows,
}, null, 2), 'utf8');

const csvColumns = [
  ['sku', (row) => row.sku], ['category', (row) => row.category_key], ['series', (row) => row.series],
  ['name_en', (row) => row.name.en], ['name_de', (row) => row.name.de], ['name_ja', (row) => row.name.ja],
  ['source_url', (row) => row.source.url], ['source_checked_at', (row) => row.source.checked_at],
  ['official_image', (row) => row.image.local_path],
  ['finishes', (row) => row.finishes.map((finish) => finish.official_label).join(' | ')],
  ['finish_photo_count', (row) => row.finishes.filter((finish) => finish.photo_available).length],
  ['material_status', (row) => row.public_status.material], ['dimensions_status', (row) => row.public_status.dimensions],
  ['moq_status', (row) => row.public_status.moq], ['lead_time_status', (row) => row.public_status.lead_time],
  ['certification_status', (row) => row.public_status.certification],
  ['needs_confirmation', (row) => row.needs_company_confirmation],
];
const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
const csv = [csvColumns.map(([label]) => label).join(',')];
for (const row of rows) csv.push(csvColumns.map(([, getter]) => escape(getter(row))).join(','));
fs.writeFileSync(path.join(OUT, 'product_library.csv'), csv.join('\n'), 'utf8');

const categoryCounts = {};
for (const row of rows) categoryCounts[row.category_key] = (categoryCounts[row.category_key] || 0) + 1;
const finishPhotoCount = rows.reduce((sum, row) => sum + row.finishes.filter((finish) => finish.photo_available).length, 0);
const readme = `# OLANG product data library

Generated: ${new Date().toISOString()}

This export is the traceable product record used by the prototype. It is not a price list, a technical data sheet or a company-issued catalogue of dimensions.

## Contents

- \`product_library.json\` — full record including field states and source notes.
- \`product_library.csv\` — flat index for spreadsheet review.
- Models: **${rows.length}** across **${Object.keys(categoryCounts).length}** categories.
- Official finish photographs linked: **${finishPhotoCount}**.
- Category counts: ${JSON.stringify(categoryCounts)}.

## Confirmed versus request-only

Confirmed from OLANG public product pages:

- model number;
- product type/category;
- series where published;
- one official product photograph per SKU;
- finish names printed on the product page;
- some additional official finish photographs.

Not published and therefore **not invented**:

- dimensions and dimension drawings;
- product-specific material grade;
- installation method and fixing kit;
- included components;
- net weight;
- inner box / master carton;
- MOQ and lead time;
- product certificate / test report;
- price.

For those fields the website shows \`on request\`, \`available on request\` or \`being confirmed\`. A request can be submitted from the product page or the Resources centre.

## Known data-quality issues

- **OL-1205**: OLANG's public page labels the model as a Towel Ring, but the official photograph published for the same model shows a long towel bar. The website carries a visible quality note; the physical form must be confirmed by OLANG.
- **OL-5201B**: the official image is a line drawing rather than a product photograph. The website carries a visible quality note.
- Five legacy image files in the public directory have a PNG signature behind a \`.jpg\` extension; the responsive WebP derivatives used by the website are valid. The source files remain unchanged for provenance.
- The public page displays placeholder retail/market price \`999\` and stock \`3996\`. These are platform presentation artefacts and are **not** used as OLANG commercial data.

## Source and rights

The source page for every SKU is recorded in \`source.url\`. Product photography belongs to OLANG and is used in this academic prototype from the company's public pages; it remains subject to OLANG's authorization before public deployment. No competitor image is included.
`;
fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');
console.log(JSON.stringify({ products: rows.length, categories: Object.keys(categoryCounts).length, finishPhotos: finishPhotoCount, out: OUT }, null, 2));

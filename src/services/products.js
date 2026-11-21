'use strict';

const { applyImageGeometry } = require('../lib/image-ratio');
const { displayFinish } = require('../i18n/glossary');

const ATTR_KEYS = [
  'material', 'brass_grade', 'steel_grade', 'dimensions', 'weight', 'finish', 'installation',
  'included_accessories', 'applicable_environment', 'moq', 'lead_time',
  'packaging', 'inner_box', 'master_carton', 'customization', 'private_label',
  'certification', 'price',
];

const ATTR_STATUSES = ['verified', 'company_provided', 'confirmed', 'illustrative', 'pending_verification', 'available_on_request', 'not_applicable', 'customizable'];

const CUSTOMER_STATUS = {
  verified: 'confirmed',
  company_provided: 'confirmed',
  confirmed: 'confirmed',
  illustrative: 'illustrative',
  reference: 'reference',
  pending_verification: 'pending_verification',
  available_on_request: 'available_on_request',
  not_applicable: 'not_applicable',
  customizable: 'customizable',
};

function customerStatus(status) {
  return CUSTOMER_STATUS[status] || 'available_on_request';
}

const SEARCH_SYNONYMS = {
  'clothes hook': 'robe hook',
  'bademantelhaken': 'robe hook',
  'gancio portaccappatoio': 'robe hook',
  'single cup': 'tumbler holder',
  'becherhalter': 'tumbler holder',
  'portabicchiere': 'tumbler holder',
  'towel rail': 'towel bar',
  'handtuchstange': 'towel bar',
  'portasciugamani': 'towel bar',
  'paper holder': 'toilet paper holder',
  'toilettenpapierhalter': 'toilet paper holder',
  'portarotolo': 'toilet paper holder',
  'grab rail': 'grab bar',
  'haltestange': 'grab bar',
  'maniglione': 'grab bar',
  'messing': 'brass',
  'ottone': 'brass',
  'edelstahl': 'stainless steel',
  'acciaio inox': 'stainless steel',
  '真鍮': 'brass',
  '石けん皿': 'ソープディッシュ',
  '石鹸皿': 'ソープディッシュ',
  'タオル掛け': 'タオルバー',
  '手すり': 'グラブバー',
  '紙巻器': 'トイレットペーパー',
  'ブラシホルダー': 'トイレブラシ',
  'コーナー棚': 'コーナーシェルフ',
  'クローム': 'chrome',
  'ゴールド': 'gold',
  'マットブラック': 'matte black',
};

function expandQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const terms = new Set([raw]);
  const lower = raw.toLowerCase();
  for (const [phrase, canonical] of Object.entries(SEARCH_SYNONYMS)) {
    if (lower.includes(phrase)) terms.add(canonical);
  }
  return [...terms].slice(0, 4);
}

function likeValue(value) {
  return `%${String(value).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function localeFor(locale) {
  return locale === 'de' || locale === 'it' || locale === 'ja' ? locale : 'en';
}

function localizedTranslation(translations, locale) {
  const lang = localeFor(locale);
  return translations[lang] || translations.en || Object.values(translations)[0] || null;
}

function getAllCategories(db, locale = 'en') {
  const lang = localeFor(locale);
  return db.prepare(`
    SELECT c.id, c.key, c.slug,
           COALESCE(ct.name, cte.name) AS name,
           COALESCE(ct.description, cte.description, '') AS description,
           COALESCE(ct.seo_title, cte.seo_title, '') AS seo_title,
           COALESCE(ct.seo_description, cte.seo_description, '') AS seo_description,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.published = 1) AS product_count
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = ?
    LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
    WHERE c.published = 1
    ORDER BY c.sort_order, c.id
  `).all(lang);
}

function getCategoryBySlug(db, slug, locale = 'en') {
  const lang = localeFor(locale);
  return db.prepare(`
    SELECT c.id, c.key, c.slug,
           COALESCE(ct.name, cte.name) AS name,
           COALESCE(ct.description, cte.description, '') AS description,
           COALESCE(ct.seo_title, cte.seo_title, '') AS seo_title,
           COALESCE(ct.seo_description, cte.seo_description, '') AS seo_description
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = ?
    LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
    WHERE c.slug = ? AND c.published = 1
  `).get(lang, slug);
}

function getSeriesFacet(db) {
  return db.prepare(`
    SELECT series, COUNT(*) AS count FROM products
    WHERE published = 1 AND series IS NOT NULL AND TRIM(series) <> ''
    GROUP BY series ORDER BY series
  `).all();
}

function getCollectionFacet(db) {
  return db.prepare(`
    SELECT collection, COUNT(*) AS count FROM products
    WHERE published = 1 AND collection IS NOT NULL AND TRIM(collection) <> ''
    GROUP BY collection ORDER BY collection
  `).all();
}

function getSeriesFinishes(db, series, locale = 'en') {
  const lang = localeFor(locale);
  return db.prepare(`
    SELECT oc.official_label AS code, oc.display_label AS label, oc.chip_path,
           COUNT(DISTINCT pc.product_id) AS count
    FROM official_colors oc
    JOIN product_colors pc ON pc.color_id = oc.id
    JOIN products p ON p.id = pc.product_id AND p.published = 1
    WHERE p.series = @series
    GROUP BY oc.id
    HAVING count > 0
    ORDER BY oc.display_label
  `).all({ series }).map((row) => ({
    code: row.code,
    name: lang === 'ja' ? displayFinish(row.label, 'ja') : row.label,
    chip: row.chip_path,
    count: row.count,
  }));
}

function getFinishFacet(db, locale = 'en') {
  const lang = localeFor(locale);
  return db.prepare(`
    SELECT oc.official_label AS code, oc.display_label AS label, oc.chip_path,
           COUNT(DISTINCT pc.product_id) AS count
    FROM official_colors oc
    JOIN product_colors pc ON pc.color_id = oc.id
    JOIN products p ON p.id = pc.product_id AND p.published = 1
    GROUP BY oc.id
    HAVING count > 0
    ORDER BY oc.display_label
  `).all().map((row) => ({
    code: row.code,
    name: lang === 'ja' ? displayFinish(row.label, 'ja') : row.label,
    chip: row.chip_path,
    count: row.count,
  }));
}

function getAttributeFacet(db, attrKey) {
  return db.prepare(`
    SELECT pa.value, COUNT(DISTINCT pa.product_id) AS count
    FROM product_attributes pa
    JOIN products p ON p.id = pa.product_id AND p.published = 1
    WHERE pa.attr_key = ? AND pa.value IS NOT NULL AND TRIM(pa.value) <> ''
      AND pa.status IN ('verified','company_provided')
    GROUP BY pa.value ORDER BY pa.value
  `).all(attrKey);
}

function productBaseQuery() {
  return `
    SELECT p.id, p.sku, p.slug, p.series, p.collection, p.image_path, p.published, p.sort_order,
           p.source_url, p.source_checked_at, p.source_note, p.category_id,
           c.key AS category_key, c.slug AS category_slug,
           COALESCE(cat.name, cate.name) AS category_name,
           COALESCE(pt.name, pte.name) AS name,
           COALESCE(pt.short_description, pte.short_description, '') AS short_description,
           COALESCE(pt.description, pte.description, '') AS description,
           COALESCE(pt.seo_title, pte.seo_title, '') AS seo_title,
           COALESCE(pt.seo_description, pte.seo_description, '') AS seo_description,
           pt.translation_status AS translation_status,
           (SELECT COUNT(*) FROM product_finishes pf WHERE pf.product_id = p.id) AS finish_count,
           (SELECT COALESCE(json_group_array(json_object('name', oc.display_label, 'chip', oc.chip_path, 'official', oc.official_label)), '[]')
              FROM product_colors pc JOIN official_colors oc ON oc.id = pc.color_id
              WHERE pc.product_id = p.id) AS colors_json,
           (SELECT ia.natural_width FROM image_assets ia WHERE ia.product_id = p.id AND ia.kind = 'product' ORDER BY ia.id LIMIT 1) AS image_natural_width,
           (SELECT ia.natural_height FROM image_assets ia WHERE ia.product_id = p.id AND ia.kind = 'product' ORDER BY ia.id LIMIT 1) AS image_natural_height,
           (SELECT ia.aspect_ratio FROM image_assets ia WHERE ia.product_id = p.id AND ia.kind = 'product' ORDER BY ia.id LIMIT 1) AS image_aspect_ratio,
           (SELECT ia.background_hex FROM image_assets ia WHERE ia.product_id = p.id AND ia.kind = 'product' ORDER BY ia.id LIMIT 1) AS image_background_hex,
           (SELECT value FROM product_attributes pca WHERE pca.product_id = p.id AND pca.attr_key = 'material' AND pca.status IN ('verified','company_provided','confirmed') LIMIT 1) AS card_material,
           (SELECT value FROM product_attributes pcd WHERE pcd.product_id = p.id AND pcd.attr_key = 'dimensions' LIMIT 1) AS card_dimensions,
           (SELECT value FROM product_attributes pcf WHERE pcf.product_id = p.id AND pcf.attr_key = 'finish' LIMIT 1) AS card_finish
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN category_translations cat ON cat.category_id = c.id AND cat.locale = @locale
    LEFT JOIN category_translations cate ON cate.category_id = c.id AND cate.locale = 'en'
    LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = @locale
    LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
  `;
}

function listProducts(db, options = {}) {
  const locale = localeFor(options.locale || 'en');
  const params = { locale };
  const where = ['p.published = 1'];
  if (options.category) {
    where.push('c.slug = @category');
    params.category = options.category;
  }
  if (options.series) {
    where.push('p.series = @series');
    params.series = options.series;
  }
  if (options.collection) {
    where.push('p.collection = @collection');
    params.collection = options.collection;
  }
  if (options.finish) {
    where.push(`EXISTS (
      SELECT 1 FROM product_colors pc2 JOIN official_colors oc2 ON oc2.id = pc2.color_id
      WHERE pc2.product_id = p.id AND oc2.official_label = @finish
    )`);
    params.finish = options.finish;
  }
  if (options.material) {
    where.push(`EXISTS (
      SELECT 1 FROM product_attributes pa2 WHERE pa2.product_id = p.id
      AND pa2.attr_key = 'material' AND pa2.value = @material
      AND pa2.status IN ('verified','company_provided','confirmed')
    )`);
    params.material = options.material;
  }
  if (options.application) {
    where.push(`EXISTS (
      SELECT 1 FROM product_attributes pa4 WHERE pa4.product_id = p.id
      AND pa4.attr_key = 'applicable_environment' AND pa4.value = @application
      AND pa4.status IN ('verified','company_provided','confirmed')
    )`);
    params.application = options.application;
  }
  if (options.oem === 'yes') {
    where.push(`EXISTS (
      SELECT 1 FROM product_attributes pa3 WHERE pa3.product_id = p.id
      AND pa3.attr_key = 'customization' AND pa3.status IN ('verified','company_provided','confirmed','customizable')
      AND LOWER(pa3.value) NOT IN ('no','none','not available')
    )`);
  }
  if (options.q) {
    const terms = expandQuery(options.q);
    const clauses = terms.map((term, index) => {
      const param = `q${index}`;
      params[param] = likeValue(term);
      return `(p.sku LIKE @${param} ESCAPE '\\'
        OR COALESCE(pt.name, pte.name) LIKE @${param} ESCAPE '\\'
        OR COALESCE(pt.short_description, pte.short_description, '') LIKE @${param} ESCAPE '\\'
        OR COALESCE(pt.description, pte.description, '') LIKE @${param} ESCAPE '\\'
        OR COALESCE(cat.name, cate.name) LIKE @${param} ESCAPE '\\'
        OR COALESCE(p.series, '') LIKE @${param} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM product_attributes paq WHERE paq.product_id = p.id AND paq.value LIKE @${param} ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM product_finishes pfq JOIN finishes fq ON fq.id = pfq.finish_id WHERE pfq.product_id = p.id AND fq.name_en LIKE @${param} ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM product_colors pcq JOIN official_colors ocq ON ocq.id = pcq.color_id WHERE pcq.product_id = p.id AND (ocq.official_label LIKE @${param} ESCAPE '\\' OR ocq.display_label LIKE @${param} ESCAPE '\\')))`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }

  let order = 'p.sort_order, p.id';
  if (options.sort === 'sku') order = 'p.sku';
  if (options.sort === 'name') order = 'COALESCE(pt.name, pte.name) COLLATE NOCASE';
  if (options.sort === 'category') order = 'COALESCE(cat.name, cate.name) COLLATE NOCASE, p.sort_order';
  if (options.sort === 'newest') order = 'p.updated_at DESC, p.id DESC';

  return db.prepare(`
    ${productBaseQuery()}
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
  `).all(params).map(applyImageGeometry);
}

function getProductBySlug(db, slug, locale = 'en') {
  const lang = localeFor(locale);
  const product = db.prepare(`
    ${productBaseQuery()}
    WHERE p.slug = @slug AND p.published = 1
  `).get({ slug, locale: lang });
  if (!product) return null;
  return enrichProduct(db, product, lang);
}

function getProductById(db, id, locale = 'en') {
  const lang = localeFor(locale);
  const product = db.prepare(`
    ${productBaseQuery()}
    WHERE p.id = @id
  `).get({ id, locale: lang });
  if (!product) return null;
  return enrichProduct(db, product, lang);
}

function getProductBySku(db, sku, locale = 'en') {
  const lang = localeFor(locale);
  const product = db.prepare(`
    ${productBaseQuery()}
    WHERE p.sku = @sku
  `).get({ sku, locale: lang });
  if (!product) return null;
  return enrichProduct(db, product, lang);
}

function enrichProduct(db, product, locale = 'en') {
  const translations = db.prepare('SELECT * FROM product_translations WHERE product_id = ?').all(product.id);
  const translationMap = {};
  for (const row of translations) translationMap[row.locale] = row;
  const attrs = db.prepare('SELECT * FROM product_attributes WHERE product_id = ? ORDER BY sort_order, attr_key').all(product.id);
  const attrMap = {};
  for (const attr of attrs) attrMap[attr.attr_key] = attr;
  const lang = localeFor(locale);
  const finishes = db.prepare(`
    SELECT f.id, f.code,
      CASE ? WHEN 'de' THEN f.name_de WHEN 'it' THEN f.name_it WHEN 'ja' THEN f.name_ja ELSE f.name_en END AS name,
      pf.status, pf.note
    FROM product_finishes pf JOIN finishes f ON f.id = pf.finish_id
    WHERE pf.product_id = ? ORDER BY f.sort_order
  `).all(lang, product.id);
  const colorThumbSlug = (label) => String(label || '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const colors = db.prepare(`
    SELECT oc.id, oc.official_label, oc.display_label, oc.kind, oc.chip_path, pc.sort_order,
      pci.local_path AS image_path,
      pci.source_image_url AS image_source_url,
      pci.source_page AS image_source_page
    FROM product_colors pc
    JOIN official_colors oc ON oc.id = pc.color_id
    LEFT JOIN product_color_images pci ON pci.product_id = pc.product_id AND pci.official_label = oc.official_label
    WHERE pc.product_id = ?
    ORDER BY CASE WHEN oc.display_label = 'Chrome' THEN 0 ELSE 1 END, pc.sort_order, oc.id
  `).all(product.id).map((color) => ({
    ...color,
    localized_label: displayFinish(color.display_label, lang),
    thumb_path: color.image_path
      ? `/images/products/official/thumbs/${product.sku}-${colorThumbSlug(color.official_label)}.jpg`
      : '',
  }));
  const documents = db.prepare(`
    SELECT * FROM documents
    WHERE product_id = ? AND visibility IN ('public','request') AND status <> 'withdrawn'
    ORDER BY doc_type, id
  `).all(product.id).map((doc) => ({ ...doc, markets: JSON.parse(doc.markets || '[]') }));
  return { ...applyImageGeometry(product), translations: translationMap, attrMap, attributes: attrs, colors, colors_json: JSON.stringify(colors.map((c) => ({ name: c.localized_label || c.display_label, chip: c.chip_path }))), finishes: finishes.map((finish) => ({ ...finish, status: /Reference finish|Illustrative finish/i.test(String(finish.note || '')) ? 'reference' : finish.status })), documents };
}

function getRelatedProducts(db, product, locale = 'en', limit = 4) {
  return db.prepare(`
    ${productBaseQuery()}
    WHERE p.published = 1 AND p.id <> @id
      AND (p.category_id = @categoryId OR c.key = @categoryKey)
    ORDER BY CASE WHEN p.category_id = @categoryId THEN 0 ELSE 1 END, p.sort_order
    LIMIT @limit
  `).all({ id: product.id, categoryId: product.category_id, categoryKey: product.category_key, locale: localeFor(locale), limit }).map(applyImageGeometry);
}

function getProductsBySkus(db, skus, locale = 'en') {
  const unique = [...new Set((skus || []).filter(Boolean))].slice(0, 10);
  if (!unique.length) return [];
  const params = { locale: localeFor(locale) };
  const placeholders = unique.map((sku, index) => {
    params[`sku${index}`] = sku;
    return `@sku${index}`;
  }).join(',');
  const rows = db.prepare(`
    ${productBaseQuery()}
    WHERE p.published = 1 AND p.sku IN (${placeholders})
    ORDER BY p.sort_order
  `).all(params);
  return rows.map((row) => enrichProduct(db, row, locale));
}

function compareProducts(db, skus, locale = 'en') {
  return getProductsBySkus(db, skus, locale);
}

function getMarketFeaturedProducts(db, market, locale = 'en', limit = 8) {
  const rows = db.prepare(`
    ${productBaseQuery()}
    JOIN market_featured_products mf ON mf.product_id = p.id AND mf.market = @market
    WHERE p.published = 1
    ORDER BY mf.sort_order, p.sort_order
    LIMIT @limit
  `).all({ locale: localeFor(locale), market, limit }).map(applyImageGeometry);
  if (rows.length) return rows;
  return listProducts(db, { locale, sort: 'sku' }).slice(0, limit);
}

function getAttributeLabelKeys() {
  return ATTR_KEYS.slice();
}

module.exports = {
  ATTR_KEYS,
  ATTR_STATUSES,
  customerStatus,
  localeFor,
  localizedTranslation,
  getAllCategories,
  getCategoryBySlug,
  getSeriesFacet,
  getCollectionFacet,
  getSeriesFinishes,
  getFinishFacet,
  getAttributeFacet,
  listProducts,
  getProductBySlug,
  getProductById,
  getProductBySku,
  getRelatedProducts,
  getProductsBySkus,
  getMarketFeaturedProducts,
  compareProducts,
  getAttributeLabelKeys,
  likeValue,
  expandQuery,
};

'use strict';

/*
 * One-time catalogue migration. The public source contains 123 product records
 * across 11 categories, 7 numbered series and the Construction Hardware group.
 * This migration is version-gated so later edits in the staff portal survive
 * ordinary restarts.
 */

const { nowIso } = require('../lib/util');
const { transaction } = require('./index');
const { getSetting, setSetting } = require('../services/settings');
const catalog = require('./catalog.json');
const { MARKETS } = require('../i18n/markets');

const CATALOG_VERSION = '2';
const ATTRS = [
  'material', 'brass_grade', 'dimensions', 'weight', 'finish', 'installation',
  'included_accessories', 'applicable_environment', 'moq', 'lead_time',
  'packaging', 'inner_box', 'master_carton', 'customization', 'private_label',
  'certification', 'price', 'warranty',
];

const FINISHES = [
  { code: 'chrome', en: 'Chrome', de: 'Chrom', it: 'Cromo' },
  { code: 'brushed-gold', en: 'Brushed Gold', de: 'Gebürstetes Gold', it: 'Oro spazzolato' },
  { code: 'matte-black', en: 'Matte Black', de: 'Mattschwarz', it: 'Nero opaco' },
];

const APPLICATIONS = {
  'grab-bar': 'Accessible bathrooms',
  'corner-shelf': 'Residential bathrooms',
  default: 'Hotel and residential bathrooms',
};

function seoTitle(name, sku) {
  return `${name} ${sku} | OLANG`;
}

function seedCatalogue(db, log = console) {
  if (getSetting(db, 'catalog.version', '') === CATALOG_VERSION) return { skipped: true };

  transaction(db, () => {
    const now = nowIso();
    const upsertCategory = db.prepare(`
      INSERT INTO categories (key, slug, sort_order, published, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        slug = excluded.slug, sort_order = excluded.sort_order, published = 1, updated_at = excluded.updated_at
    `);
    const upsertCategoryTranslation = db.prepare(`
      INSERT INTO category_translations (category_id, locale, name, description, seo_title, seo_description)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_id, locale) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        seo_title = excluded.seo_title, seo_description = excluded.seo_description
    `);

    for (const category of catalog.categories) {
      upsertCategory.run(category.key, category.slug, category.sortOrder, now, now);
      const row = db.prepare('SELECT id FROM categories WHERE key = ?').get(category.key);
      for (const locale of ['en', 'de', 'it']) {
        const name = category[locale];
        const description = category.description[locale];
        upsertCategoryTranslation.run(
          row.id, locale, name, description,
          `${name} | OLANG`,
          `${description} Browse models, request specifications and submit a procurement inquiry.`.slice(0, 300),
        );
      }
    }

    const upsertProduct = db.prepare(`
      INSERT INTO products (
        sku, slug, category_id, series, collection, image_path, published, sort_order,
        source_url, source_checked_at, source_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO UPDATE SET
        slug = excluded.slug, category_id = excluded.category_id, series = excluded.series,
        collection = excluded.collection, image_path = excluded.image_path, published = 1,
        sort_order = excluded.sort_order, source_url = excluded.source_url,
        source_checked_at = excluded.source_checked_at, source_note = excluded.source_note,
        updated_at = excluded.updated_at
    `);
    const upsertProductTranslation = db.prepare(`
      INSERT INTO product_translations (
        product_id, locale, name, short_description, description, seo_title, seo_description, translation_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id, locale) DO UPDATE SET
        name = excluded.name, short_description = excluded.short_description,
        description = excluded.description, seo_title = excluded.seo_title,
        seo_description = excluded.seo_description, translation_status = excluded.translation_status
    `);
    const upsertAttribute = db.prepare(`
      INSERT INTO product_attributes (
        product_id, attr_key, value, unit, status, source_note,
        data_source, last_verified_at, internal_note, visible_frontend, sort_order, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, 1, ?, ?)
      ON CONFLICT(product_id, attr_key) DO UPDATE SET
        value = excluded.value, unit = NULL, status = excluded.status,
        source_note = excluded.source_note, data_source = excluded.data_source,
        last_verified_at = NULL, internal_note = NULL, visible_frontend = 1,
        sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `);
    const upsertFinish = db.prepare(`
      INSERT INTO product_finishes (product_id, finish_id, status, note)
      VALUES (?, ?, 'available_on_request', ?)
      ON CONFLICT(product_id, finish_id) DO UPDATE SET
        status = excluded.status, note = excluded.note
    `);

    const sourceNote = 'Model, product type, series and image confirmed on the public OLANG product page. Commercial and technical values are confirmed before quotation.';

    for (const product of catalog.products) {
      const category = db.prepare('SELECT id FROM categories WHERE key = ?').get(product.category);
      if (!category) throw new Error(`Missing category ${product.category}`);
      upsertProduct.run(
        product.sku, product.slug, category.id, product.series, product.collection || null,
        product.image, product.sortOrder, product.sourceUrl, product.sourceCheckedAt,
        sourceNote, now, now,
      );
      const row = db.prepare('SELECT id FROM products WHERE sku = ?').get(product.sku);
      for (const locale of ['en', 'de', 'it']) {
        const translated = product.translations[locale];
        upsertProductTranslation.run(
          row.id, locale, translated.name, translated.short, translated.description,
          seoTitle(translated.name, product.sku), translated.seo_description,
          locale === 'en' ? 'reviewed' : 'ai_draft',
        );
      }

      for (const key of ATTRS) {
        let value = null;
        let status = 'available_on_request';
        let note = 'Not published for this SKU. Confirmed for the exact model and order before quotation.';
        if (key === 'material' || key === 'brass_grade') {
          status = 'pending_verification';
          note = 'The public record does not confirm the material grade. OLANG’s company profile describes brass bathroom hardware; verify the exact SKU before ordering.';
        }
        if (key === 'finish') {
          note = 'Finish names published by OLANG. Availability for this SKU, coating standard and test evidence are confirmed before quotation.';
        }
        if (key === 'applicable_environment') {
          value = APPLICATIONS[product.category] || APPLICATIONS.default;
          status = 'reference';
          note = 'Application grouping follows the published product type and OLANG’s company profile. Project suitability is confirmed per SKU.';
        }
        if (key === 'customization' || key === 'private_label') {
          value = 'Project-specific review';
          status = 'customizable';
          note = 'OLANG publicly describes OEM/ODM and private-label support. Feasibility, tooling, MOQ and timing are confirmed for the specific product and project.';
        }
        if (key === 'certification') {
          status = 'pending_verification';
          note = 'No product-level certificate or test report is published. Request the document for the exact SKU and destination market.';
        }
        if (key === 'price') {
          note = 'No verified public price list. Quotation follows the confirmed specification, quantity and delivery terms.';
        }
        if (key === 'warranty') {
          note = 'Warranty terms are not published. Confirm in writing for the exact product and market.';
        }
        upsertAttribute.run(
          row.id, key, value, status, note, product.sourceUrl,
          ATTRS.indexOf(key) + 1, now,
        );
      }

      for (const finish of FINISHES) {
        const finishRow = db.prepare('SELECT id FROM finishes WHERE code = ?').get(finish.code);
        if (!finishRow) continue;
        upsertFinish.run(
          row.id, finishRow.id,
          'Finish name belongs to OLANG’s published range. Availability and coating specification for this SKU are confirmed on request.',
        );
      }
    }

    seedMarkets(db, now);
    // The earlier prototype seeded OL-1160 from ProductDetail/96. The current
    // public page publishes that product as OL-11608. Retain the old row for
    // audit/history but remove it from the public catalogue to avoid duplicate
    // and model/image mismatch.
    db.prepare(`
      UPDATE products SET published = 0,
        source_note = 'Superseded by OL-11608 on the current public OLANG product page; retained for historical reference only.',
        updated_at = ?
      WHERE sku = 'OL-1160'
    `).run(now);
    setSetting(db, 'catalog.version', CATALOG_VERSION);
    setSetting(db, 'catalog.migrated_at', now);
  });

  log.info(`[catalog] migrated ${catalog.products.length} products, ${catalog.categories.length} categories, 7 numbered series and Construction Hardware`);
  return { skipped: false, products: catalog.products.length };
}

function seedMarkets(db, now = nowIso()) {
  const featureSets = {
    en: ['OL-1204', 'OL-1205', 'OL-1208', 'OL-1209', 'OL-1706B', 'OL-6602', 'OL-11608', 'OL-5201B'],
    'en-us': ['OL-1204', 'OL-1205', 'OL-1208', 'OL-1209', 'OL-1706B', 'OL-11608', 'OL-5201B', 'OL-1211A'],
    'en-au': ['OL-1205', 'OL-1208', 'OL-1209', 'OL-1706B', 'OL-6602', 'OL-5201B', 'OL-1211A', 'OL-1711'],
    'en-gb': ['OL-1204', 'OL-1205', 'OL-1208', 'OL-1706B', 'OL-6602', 'OL-11608', 'OL-5201B', 'OL-5209'],
    de: ['OL-1204', 'OL-1208', 'OL-1209', 'OL-1706B', 'OL-6602', 'OL-11608', 'OL-5201B', 'OL-7209'],
    it: ['OL-1204', 'OL-1205', 'OL-1209', 'OL-1706B', 'OL-6602', 'OL-11608', 'OL-5201B', 'OL-7205'],
  };
  const units = { 'en-us': 'imperial' };
  const currencies = { en: 'EUR', 'en-us': 'USD', 'en-au': 'AUD', 'en-gb': 'GBP', de: 'EUR', it: 'EUR' };
  const compliance = {
    en: {
      en: 'Compliance scope is confirmed per SKU and destination.',
      de: 'Der Konformitätsumfang wird je Artikel und Zielmarkt bestätigt.',
      it: 'L’ambito di conformità è confermato per articolo e destinazione.',
    },
    'en-us': {
      en: 'US compliance scope, including ADA or Prop 65 where applicable, is confirmed for the exact SKU and use.',
      de: 'Der US-Konformitätsumfang, einschließlich ADA oder Prop 65 soweit zutreffend, wird für den exakten Artikel und Verwendungszweck bestätigt.',
      it: 'L’ambito di conformità USA, inclusi ADA o Prop 65 ove applicabili, è confermato per articolo e uso previsti.',
    },
    'en-au': {
      en: 'WaterMark and AS/NZS scope is confirmed for the relevant product and application.',
      de: 'WaterMark- und AS/NZS-Umfang werden für das relevante Produkt und den Verwendungszweck bestätigt.',
      it: 'L’ambito WaterMark e AS/NZS è confermato per prodotto e applicazione pertinenti.',
    },
    'en-gb': {
      en: 'UKCA, CE and importer requirements are confirmed for the exact product and route to market.',
      de: 'UKCA-, CE- und Importeur-Anforderungen werden für den exakten Artikel und Marktweg bestätigt.',
      it: 'I requisiti UKCA, CE e per l’importatore sono confermati per articolo e canale di mercato.',
    },
    de: {
      en: 'CE, REACH and other requirements are confirmed for the exact product and intended use.',
      de: 'CE-, REACH- und weitere Anforderungen werden für den exakten Artikel und Verwendungszweck bestätigt.',
      it: 'I requisiti CE, REACH e altri sono confermati per l’articolo e l’uso previsto.',
    },
    it: {
      en: 'CE, REACH and other requirements are confirmed for the exact product and intended use.',
      de: 'CE-, REACH- und weitere Anforderungen werden für den exakten Artikel und Verwendungszweck bestätigt.',
      it: 'I requisiti CE, REACH e altri sono confermati per articolo e uso previsto.',
    },
  };
  const insertMarket = db.prepare(`
    INSERT INTO market_settings (
      market, unit_system, currency, accent, accent_soft, compliance_en, compliance_de, compliance_it, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market) DO NOTHING
  `);
  for (const [code, market] of Object.entries(MARKETS)) {
    const note = compliance[code] || compliance.en;
    insertMarket.run(
      code, units[code] || 'metric', currencies[code] || 'EUR', market.accent, market.accentSoft,
      note.en, note.de, note.it, now,
    );
    const existing = db.prepare('SELECT COUNT(*) AS c FROM market_featured_products WHERE market = ?').get(code);
    if (existing.c) continue;
    const insertFeature = db.prepare(`
      INSERT OR IGNORE INTO market_featured_products (market, product_id, sort_order)
      SELECT ?, id, ? FROM products WHERE sku = ?
    `);
    (featureSets[code] || featureSets.en).forEach((sku, index) => insertFeature.run(code, index + 1, sku));
  }
}

module.exports = { seedCatalogue, seedMarkets, CATALOG_VERSION, ATTRS, FINISHES };



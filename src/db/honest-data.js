'use strict';

/**
 * Repairs the public catalogue data after the earlier illustrative seed.
 *
 * The public OLANG product pages confirm a model, category, series, official
 * photograph and a set of finish names. They do not publish dimensions,
 * material grade, installation, packing, MOQ, lead time, price or a product
 * certificate. This module removes the earlier numeric "reference assumptions"
 * and writes the fields back as explicit request states.
 */
const fs = require('node:fs');
const path = require('node:path');
const { nowIso } = require('../lib/util');
const { transaction } = require('./index');
const { getSetting, setSetting } = require('../services/settings');

const HONEST_VERSION = '2';

const CATEGORY = {
  'soap-dish-holder': { en: 'Soap Dish Holder', de: 'Seifenschalenhalter', ja: 'ソープディッシュホルダー', useEn: 'Holds a bar of soap at a basin or bath.', useDe: 'Hält ein Stück Seife am Waschbecken oder an der Badewanne.', useJa: '洗面台や浴槽まわりで石けんを置くための金物です。' },
  'tumbler-holder': { en: 'Tumbler Holder', de: 'Zahnputzbecherhalter', ja: 'タンブラーホルダー', useEn: 'Holds a bathroom tumbler at the basin.', useDe: 'Hält einen Zahnputzbecher am Waschbecken.', useJa: '洗面台でタンブラー（コップ）を保持するための金物です。' },
  'robe-hook': { en: 'Robe Hook', de: 'Bademantelhaken', ja: 'ローブフック', useEn: 'Hangs a robe, towel or light clothing on the dry side of the bathroom.', useDe: 'Hält Bademantel, Handtuch oder leichte Kleidung im trockenen Bereich des Bades.', useJa: '浴室の乾燥した場所で、バスローブやタオル、衣類を掛けるためのフックです。' },
  'towel-ring': { en: 'Towel Ring', de: 'Handtuchring', ja: 'タオルリング', useEn: 'Keeps a hand towel within reach beside a basin.', useDe: 'Hält ein Handtuch griffbereit neben dem Waschbecken.', useJa: '洗面台のそばでハンドタオルを掛けておくためのリングです。' },
  'toilet-paper-holder': { en: 'Toilet Paper Holder', de: 'Toilettenpapierhalter', ja: 'トイレットペーパーホルダー', useEn: 'Holds a toilet roll in the WC area.', useDe: 'Hält eine Toilettenrolle im WC-Bereich.', useJa: 'トイレ空間でペーパーロールを保持するためのホルダーです。' },
  'toilet-brush-holder': { en: 'Toilet Brush Holder', de: 'WC-Bürstenhalter', ja: 'トイレブラシホルダー', useEn: 'Stores a toilet brush beside the WC. The supplied scope is confirmed per SKU.', useDe: 'Verwahrt eine WC-Bürste neben dem WC. Der Lieferumfang wird je Artikel bestätigt.', useJa: 'トイレのそばでブラシを収納するためのホルダーです。付属範囲は品番ごとに確認します。' },
  'single-towel-bar': { en: 'Single Towel Bar', de: 'Handtuchstange (einfach)', ja: 'シングルタオルバー', useEn: 'Hangs a bath towel on one rail.', useDe: 'Hält ein Badetuch auf einer Stange.', useJa: '1本のバーにバスタオルを掛けるためのタオルバーです。' },
  'double-towel-bar': { en: 'Double Towel Bar', de: 'Handtuchstange (doppelt)', ja: 'ダブルタオルバー', useEn: 'Hangs towels on two rails where wall space is limited.', useDe: 'Hält Handtücher auf zwei Stangen bei begrenzter Wandfläche.', useJa: '壁面を有効に使い、2本のバーでタオルを掛けるためのタオルバーです。' },
  'towel-rack': { en: 'Towel Rack', de: 'Handtuchregal', ja: 'タオルラック', useEn: 'Provides a larger hanging area for towels in a bathroom.', useDe: 'Bietet eine größere Ablage- und Hängefläche für Handtücher im Bad.', useJa: '浴室で複数のタオルを掛けるためのラックです。' },
  'grab-bar': { en: 'Grab Bar', de: 'Haltestange', ja: 'グラブバー（手すり）', useEn: 'Provides a handhold in bathroom and accessible applications. Load rating, fixing and compliance are confirmed for the exact product and wall build-up.', useDe: 'Bietet Halt im Bad und in barrierefreien Anwendungen. Belastbarkeit, Befestigung und Konformität werden für den exakten Artikel und Wandaufbau bestätigt.', useJa: '浴室やバリアフリー用途で手を支えるための手すりです。耐荷重、固定方法、適合性は、品番と下地構造に合わせて確認します。' },
  'corner-shelf': { en: 'Corner Shelf', de: 'Eckregal', ja: 'コーナーシェルフ', useEn: 'Provides storage in a bathroom corner.', useDe: 'Bietet Ablagefläche in einer Badecke.', useJa: '浴室のコーナーに収納スペースをつくるための棚です。' },
};

const CATEGORY_JA = {
  'soap-dish-holder': 'ソープディッシュホルダー', 'tumbler-holder': 'タンブラーホルダー', 'robe-hook': 'ローブフック',
  'towel-ring': 'タオルリング', 'toilet-paper-holder': 'トイレットペーパーホルダー', 'toilet-brush-holder': 'トイレブラシホルダー',
  'single-towel-bar': 'シングルタオルバー', 'double-towel-bar': 'ダブルタオルバー', 'towel-rack': 'タオルラック',
  'grab-bar': 'グラブバー', 'corner-shelf': 'コーナーシェルフ',
};

const SERIES_JA = {
  '1200 Series': '1200シリーズ', '1700 Series': '1700シリーズ', '6600 Series': '6600シリーズ',
  '7200 Series': '7200シリーズ', '7300 Series': '7300シリーズ', '7600 Series': '7600シリーズ',
  '9000 Series': '9000シリーズ', 'Engineering Hardware': '建築・設備用金物',
};

const FINISH_JA = {
  'Brushed Gold': 'ヘアラインゴールド', 'Chrome': 'クローム', 'Matte Black': 'マットブラック', 'Gunmetal': 'ガンメタル',
  'Rose Gold': 'ローズゴールド', 'Chrome + Matte Black': 'クローム＋マットブラック',
  'Rose Gold + Matte Black': 'ローズゴールド＋マットブラック', 'Gunmetal + Rose Gold': 'ガンメタル＋ローズゴールド',
  'Matte White + Matte Black': 'マットホワイト＋マットブラック', 'Matte Black + Rose Gold': 'マットブラック＋ローズゴールド',
  'Chrome + White Glass': 'クローム＋ホワイトガラス', 'Chrome + White Stone': 'クローム＋ホワイトストーン',
  'Chrome + Black Stone': 'クローム＋ブラックストーン',
};

function honestAttributeRows(product, colors) {
  const finishNames = colors.map((c) => c.display_label);
  const engineering = product.collection === 'construction-hardware';
  const rows = [
    ['material', engineering ? 'Metal range (grade to be confirmed)' : 'Brass range (grade to be confirmed)', 'pending_verification', engineering
      ? "The public product record does not publish the alloy or grade for this Construction Hardware SKU. The material declaration is confirmed per SKU."
      : "OLANG's public company profile describes premium brass bathroom hardware. This is a company-level range description, not a confirmed grade for this SKU; request the material declaration before specification."],
    ['brass_grade', null, 'pending_verification', 'No product-specific brass grade is published. Confirm against the material declaration for the exact SKU.'],
    ['steel_grade', null, 'available_on_request', 'No product-specific steel grade is published. Confirm against the material declaration for the exact SKU.'],
    ['dimensions', null, 'available_on_request', 'Dimensions are not published on the public product page. Request the dimension drawing for the exact SKU.'],
    ['weight', null, 'available_on_request', 'Net weight is not published. Confirm it with the packing specification for the SKU and order.'],
    ['finish', finishNames.join(' · ') || null, finishNames.length ? 'company_provided' : 'available_on_request', finishNames.length
      ? 'Finish names are visible on the public OLANG product page. Finish availability, coating specification and test evidence are confirmed per order.'
      : 'No finish name is published for this SKU. Request the available finish range.'],
    ['installation', null, 'available_on_request', 'Fixing method, wall structure and included fixing parts are not published. Confirm before specification.'],
    ['included_accessories', null, 'available_on_request', 'Included fixing parts and installation accessories are not published. Confirm with the specification sheet.'],
    ['applicable_environment', null, 'available_on_request', 'Application suitability is confirmed for the exact SKU, wall build-up and project.'],
    ['packaging', null, 'available_on_request', 'Inner box, master carton and packing configuration are confirmed against the actual order.'],
    ['inner_box', null, 'available_on_request', 'Inner-box dimensions are not published. Confirm with the packing specification.'],
    ['master_carton', null, 'available_on_request', 'Master-carton quantity and dimensions are not published. Confirm against the SKU and order.'],
    ['moq', null, 'available_on_request', 'No verified MOQ is published. Confirm it for the selected SKU, finish and order mix.'],
    ['lead_time', null, 'available_on_request', 'No verified production or delivery lead time is published. Confirm after specification and destination review.'],
    ['certification', null, 'pending_verification', 'No product-level certificate or test report is published. Scope depends on the SKU and destination market.'],
    ['technical_documents', null, 'available_on_request', 'Specification and drawings are released per SKU. Request the document for this model.'],
    ['customization', 'Project-specific review', 'customizable', 'OLANG publicly describes OEM/ODM support. Feasibility, tooling, sample and timing are confirmed for the specific request.'],
    ['private_label', 'Project-specific review', 'customizable', 'Private-label feasibility, artwork and packing requirements are confirmed for the specific model and order.'],
    ['price', null, 'available_on_request', 'No verified price list is published. Quotation follows the confirmed SKU, finish, quantity and delivery terms.'],
    ['warranty', null, 'available_on_request', 'Warranty terms are not published. Confirm in writing for the exact SKU and market.'],
  ];
  return rows;
}

function productCopy(product, category, series, colors) {
  const nameEn = `${category.en}`;
  const nameDe = category.de;
  const nameJa = category.ja;
  const seriesEn = series || 'Engineering Hardware';
  const seriesDe = series ? series.replace(' Series', '-Serie') : 'Objekt- und Konstruktionsbeschläge';
  const seriesJa = SERIES_JA[seriesEn] || seriesEn;
  const finishesEn = colors.map((c) => c.display_label).join(' / ');
  const finishesJa = colors.map((c) => FINISH_JA[c.display_label] || c.display_label).join(' / ');

  return {
    en: {
      name: nameEn,
      short: `${nameEn} from OLANG’s ${seriesEn}, catalogued by model and series.`,
      description: `${product.sku} is a ${nameEn.toLowerCase()} in OLANG’s ${seriesEn}. ${category.useEn} The public product record confirms the model, category, series and official photograph${finishesEn ? `, and lists these finish names: ${finishesEn}` : ''}. Dimensions, material grade, fixing method, included parts, packing, MOQ, lead time and certification are not published for this SKU. Request the specification sheet before specifying or ordering. This record is not a quotation and does not confirm that a custom change is available.`,
      seoTitle: `${product.sku} ${nameEn} · ${seriesEn} | OLANG`,
      seoDescription: `${product.sku} ${nameEn} from OLANG’s ${seriesEn}. View the official product photograph and published finish names; request dimensions, material specification, packing and quotation for the exact SKU.`,
    },
    de: {
      name: nameDe,
      short: `${nameDe} aus der ${seriesDe} von OLANG, nach Modell und Serie geführt.`,
      description: `${product.sku} ist ein ${nameDe} aus der ${seriesDe} von OLANG. ${category.useDe} Der öffentliche Produktdatensatz bestätigt Modell, Kategorie, Serie und offizielles Produktfoto${finishesEn ? ` und nennt diese Oberflächen: ${finishesEn}` : ''}. Maße, Werkstoffgüte, Befestigung, Lieferumfang, Verpackung, Mindestmenge, Lieferzeit und Zertifizierung sind für diesen Artikel nicht veröffentlicht. Fordern Sie das Datenblatt vor der Ausschreibung oder Bestellung an. Dieser Eintrag ist kein Angebot und bestätigt keine kundenspezifische Änderung.`,
      seoTitle: `${product.sku} ${nameDe} · ${seriesDe} | OLANG`,
      seoDescription: `${product.sku} ${nameDe} von OLANG, ${seriesDe}. Offizielles Produktfoto und veröffentlichte Oberflächen ansehen; Maße, Werkstoffspezifikation, Verpackung und Angebot für den exakten Artikel anfordern.`,
    },
    ja: {
      name: nameJa,
      short: `OLANGの${seriesJa}に属する${nameJa}（品番 ${product.sku}）。型番・カテゴリー・シリーズで掲載しています。`,
      description: `${product.sku}は、OLANGの${seriesJa}に属する${nameJa}です。${category.useJa} 公開製品情報では、型番、カテゴリー、シリーズ、公式製品写真${finishesJa ? `、公開されている仕上げ名（${finishesJa}）` : ''}を確認できます。寸法、材質グレード、取付方法、付属品、梱包、MOQ、納期、認証は、この品番について公開されていません。仕様確定・ご発注の前に、品番を明記して仕様書をご請求ください。このページはお見積りではなく、カスタマイズの実現を保証するものでもありません。`,
      seoTitle: `${product.sku} ${nameJa}｜${seriesJa}｜OLANG`,
      seoDescription: `${product.sku} ${nameJa}（OLANG ${seriesJa}）。公式製品写真と公開仕上げ名を掲載。寸法、材質、梱包、お見積りは品番を明記してご請求ください。`,
    },
  };
}

function upsertTranslations(db, product, category, colors) {
  const copy = productCopy(product, category, product.series, colors);
  const stmt = db.prepare(`
    INSERT INTO product_translations (product_id, locale, name, short_description, description, seo_title, seo_description, translation_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, locale) DO UPDATE SET
      name = excluded.name, short_description = excluded.short_description,
      description = excluded.description, seo_title = excluded.seo_title,
      seo_description = excluded.seo_description, translation_status = excluded.translation_status
  `);
  for (const locale of ['en', 'de', 'ja']) {
    const row = copy[locale];
    stmt.run(product.id, locale, row.name, row.short, row.description, row.seoTitle, row.seoDescription,
      locale === 'en' ? 'reviewed' : 'ai_draft');
  }
  return copy;
}

function seedJapaneseContent(db, log) {
  const newsFile = path.join(__dirname, 'ja-editorial.json');
  const faqFile = path.join(__dirname, 'ja-faq.json');
  if (fs.existsSync(newsFile)) {
    const news = JSON.parse(fs.readFileSync(newsFile, 'utf8'));
    const find = db.prepare('SELECT id FROM news_articles WHERE slug = ?');
    const upsert = db.prepare(`
      INSERT INTO news_translations (article_id, locale, title, excerpt, body, seo_title, seo_description)
      VALUES (?, 'ja', ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, locale) DO UPDATE SET
        title = excluded.title, excerpt = excluded.excerpt, body = excluded.body,
        seo_title = excluded.seo_title, seo_description = excluded.seo_description
    `);
    for (const row of news) {
      const article = find.get(row.slug);
      if (article) upsert.run(article.id, row.title, row.excerpt, row.body, row.seoTitle, row.seoDescription);
    }
    log.info(`[honest-data] Japanese news translations: ${news.length}`);
  }
  if (fs.existsSync(faqFile)) {
    const faqs = JSON.parse(fs.readFileSync(faqFile, 'utf8'));
    const find = db.prepare('SELECT id FROM faqs WHERE key = ?');
    const upsert = db.prepare(`
      INSERT INTO faq_translations (faq_id, locale, question, answer, status)
      VALUES (?, 'ja', ?, ?, 'ai_draft')
      ON CONFLICT(faq_id, locale) DO UPDATE SET question = excluded.question, answer = excluded.answer
    `);
    for (const row of faqs) {
      const faq = find.get(row.key);
      if (faq) upsert.run(faq.id, row.question, row.answer);
    }
    log.info(`[honest-data] Japanese FAQ translations: ${faqs.length}`);
  }
}

function seedHonestData(db, log = console) {
  if (getSetting(db, 'honest.version', '') === HONEST_VERSION) return { skipped: true };
  transaction(db, () => {
    const now = nowIso();
    const products = db.prepare(`
      SELECT p.*, c.key AS category_key FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.published = 1 ORDER BY p.id
    `).all();
    const deleteAttrs = db.prepare('DELETE FROM product_attributes WHERE product_id = ?');
    const insertAttr = db.prepare(`
      INSERT INTO product_attributes (
        product_id, attr_key, value, unit, status, source_note, data_source,
        last_verified_at, internal_note, visible_frontend, sort_order, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, 'public_product_page', NULL, NULL, 1, ?, ?)
    `);
    const colorsFor = db.prepare(`
      SELECT oc.display_label, oc.official_label FROM product_colors pc
      JOIN official_colors oc ON oc.id = pc.color_id WHERE pc.product_id = ? ORDER BY pc.sort_order, oc.id
    `);
    const deleteMedia = db.prepare("DELETE FROM product_media WHERE product_id = ? AND role <> 'main'");
    const sourceNote = 'Model, product type, series, product photograph and displayed finish names are confirmed on the public OLANG product page. Dimensions, material grade, fixing, packing, MOQ, lead time and certification are not published and remain on request.';
    const updateProduct = db.prepare('UPDATE products SET source_note = ?, updated_at = ? WHERE id = ?');
    for (const product of products) {
      const category = CATEGORY[product.category_key] || CATEGORY['robe-hook'];
      const colors = colorsFor.all(product.id);
      deleteAttrs.run(product.id);
      honestAttributeRows(product, colors).forEach(([key, value, status, note], index) => {
        insertAttr.run(product.id, key, value, status, note, index + 1, now);
      });
      deleteMedia.run(product.id);
      updateProduct.run(sourceNote, now, product.id);
      upsertTranslations(db, product, category, colors);
    }
    // Published finish associations keep the official label but are explicitly request-only.
    db.prepare(`
      UPDATE product_finishes
         SET status = 'available_on_request',
             note = 'The finish name is published on the OLANG product page. Availability, coating specification and test evidence are confirmed for the exact order.'
    `).run();

    // Japanese category translations.
    const catRows = db.prepare('SELECT id, key FROM categories').all();
    const upsertCategoryJa = db.prepare(`
      INSERT INTO category_translations (category_id, locale, name, description, seo_title, seo_description)
      VALUES (?, 'ja', ?, ?, ?, ?)
      ON CONFLICT(category_id, locale) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        seo_title = excluded.seo_title, seo_description = excluded.seo_description
    `);
    for (const category of catRows) {
      const meta = CATEGORY[category.key] || CATEGORY['robe-hook'];
      const name = CATEGORY_JA[category.key] || meta.ja;
      upsertCategoryJa.run(
        category.id, name,
        `OLANGの公開製品ラインナップに含まれる${name}です。`,
        `${name}｜OLANG`,
        `${name}の公開モデルを品番・シリーズで確認できます。寸法・材質・梱包などの技術情報は品番ごとにご請求ください。`,
      );
    }

    // Three published market editions. The old extra market rows are retained for audit only.
    const insertMarket = db.prepare(`
      INSERT INTO market_settings (market, unit_system, currency, accent, accent_soft, compliance_en, compliance_de, compliance_it, compliance_ja, updated_at)
      VALUES (?, 'metric', ?, ?, ?, ?, ?, '', ?, ?)
      ON CONFLICT(market) DO UPDATE SET
        unit_system = excluded.unit_system, currency = excluded.currency,
        accent = excluded.accent, accent_soft = excluded.accent_soft,
        compliance_en = excluded.compliance_en, compliance_de = excluded.compliance_de,
        compliance_ja = excluded.compliance_ja, updated_at = excluded.updated_at
    `);
    insertMarket.run('en-gb', 'GBP', '#5D4037', '#F4ECE8',
      'UK product scope is confirmed for the exact SKU and intended use. UKCA, CE and importer requirements are checked; no blanket certificate is displayed.',
      'Der UK-Produktumfang wird für den exakten Artikel und Verwendungszweck bestätigt. UKCA-, CE- und Importeurspflichten werden geprüft; keine pauschale Zertifizierung.',
      '英国向けの適合範囲は、品番と用途ごとに確認します。UKCA・CE・輸入者要件を確認し、包括的な認証表示は行いません。', now);
    insertMarket.run('de', 'EUR', '#37474F', '#E8EDEF',
      'EU product scope is confirmed for the exact SKU and intended use. CE and REACH applicability is checked; no blanket certificate is displayed.',
      'Der EU-Produktumfang wird für den exakten Artikel und Verwendungszweck bestätigt. CE- und REACH-Anwendbarkeit werden geprüft; keine pauschale Zertifizierung.',
      'EU向けの適合範囲は、品番と用途ごとに確認します。CE・REACHの適用を確認し、包括的な認証表示は行いません。', now);
    insertMarket.run('ja-jp', 'JPY', '#6F6252', '#F2EFE8',
      'Japan product scope is confirmed for the exact SKU and intended use. Applicable standards and documents depend on the product; no blanket certification is displayed.',
      'Der Japan-Produktumfang wird für den exakten Artikel und Verwendungszweck bestätigt. Anwendbare Normen hängen vom Produkt ab; keine pauschale Zertifizierung.',
      '日本向けの適合範囲は、品番と用途ごとに確認します。適用規格・資料は製品により異なり、包括的な認証表示は行いません。', now);

    const featured = ['OL-1204', 'OL-1205', 'OL-1208', 'OL-1209', 'OL-1706B', 'OL-6602', 'OL-5201B', 'OL-1211A'];
    const existing = db.prepare('SELECT COUNT(*) AS c FROM market_featured_products WHERE market = ?').get('ja-jp').c;
    if (!existing) {
      const insertFeature = db.prepare(`
        INSERT OR IGNORE INTO market_featured_products (market, product_id, sort_order)
        SELECT 'ja-jp', id, ? FROM products WHERE sku = ?
      `);
      featured.forEach((sku, index) => insertFeature.run(index + 1, sku));
    }

    const caseDescEn = 'This record reproduces a hotel project name and location published in OLANG’s public project portfolio. The exact product schedule, quantities, bathroom photographs and installation details are not published and are not inferred here. Request project documentation for verification.';
    const caseDescDe = 'Dieser Eintrag gibt einen Hotelnamen und Standort aus dem öffentlichen Projektportfolio von OLANG wieder. Genaue Produktliste, Mengen, Badezimmerfotos und Montagedetails sind nicht veröffentlicht und werden hier nicht abgeleitet. Fordern Sie die Projektunterlagen zur Prüfung an.';
    const caseDescJa = 'OLANGの公開プロジェクトページに掲載されているホテル名と所在地を転記したものです。実際の採用品番、数量、浴室写真、設置詳細は公開されていないため、このページで推測することはありません。確認にはプロジェクト資料をご請求ください。';
    const updateCase = db.prepare(`
      UPDATE case_studies SET description_en = ?, description_de = ?, description_ja = ?,
        summary_ja = ?, updated_at = ? WHERE slug = ?
    `);
    const cases = db.prepare('SELECT slug, title FROM case_studies').all();
    for (const entry of cases) {
      updateCase.run(caseDescEn, caseDescDe, caseDescJa,
        `${entry.title}は、OLANGの公開プロジェクトページに掲載されているホテル実績です。実際の採用品番・数量・浴室写真は公開されていないため、確認のうえご案内します。`, now, entry.slug);
    }

    // Existing document metadata is retained but the market list is aligned to the published editions.
    db.prepare("UPDATE documents SET markets = ? WHERE markets LIKE '%en-us%' OR markets LIKE '%it%'").run(JSON.stringify(['en-gb', 'de', 'ja-jp']));

    seedJapaneseContent(db, log);
    setSetting(db, 'honest.version', HONEST_VERSION);
  });
  log.info('[honest-data] removed illustrative values, refreshed product copy and added the Japanese edition');
  return { skipped: false };
}

module.exports = { seedHonestData, HONEST_VERSION, CATEGORY, CATEGORY_JA, SERIES_JA, FINISH_JA, honestAttributeRows };

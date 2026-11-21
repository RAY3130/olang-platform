'use strict';

/*
 * One-off remediation migration for the v4 review.
 * Run from platform/: node scripts/remediation_v4.js
 *
 * It is intentionally conservative: it only changes records the review
 * identifies, keeps the original values in internal notes where useful, and
 * records every new derived asset in image_assets.
 */

const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { nowIso } = require('../src/lib/util');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const db = openDatabase();
const now = nowIso();
const log = (...args) => console.log('[remediation]', ...args);

const categoryCopy = {
  'robe-hook': {
    en: 'a wall-mounted robe hook for the dry side of a shower, bath or vanity',
    de: 'ein wandmontierter Bademantelhaken für die trockene Seite von Dusche, Wanne oder Waschtisch',
    it: 'un gancio portaccappatoio a parete per il lato asciutto di doccia, vasca o mobile bagno',
  },
  'towel-ring': {
    en: 'a hand-towel ring for a basin, guest bathroom or hotel vanity',
    de: 'ein Handtuchring für Waschbecken, Gästebad oder Hotelwaschtisch',
    it: 'un anello portasciugamani per lavabo, bagno ospiti o mobile da hotel',
  },
  'single-towel-bar': {
    en: 'a single towel bar for a bath, shower or hotel towel station',
    de: 'eine einteilige Handtuchstange für Bad, Dusche oder Hotel-Handtuchstation',
    it: 'una barra portasciugamani singola per bagno, doccia o stazione asciugamani hotel',
  },
  'double-towel-bar': {
    en: 'a double towel bar that separates two towels in a family or hotel bathroom',
    de: 'eine doppelte Handtuchstange, die zwei Handtücher in Familien- oder Hotelbädern trennt',
    it: 'una barra portasciugamani doppia che separa due asciugamani in bagni familiari o hotel',
  },
  'towel-rack': {
    en: 'a towel rack for folded towels in a bathroom, spa or hotel room',
    de: 'ein Handtuchregal für gefaltete Handtücher in Bad, Spa oder Hotelzimmer',
    it: 'un portasciugamani per asciugamani piegati in bagno, spa o camera d’hotel',
  },
  'toilet-paper-holder': {
    en: 'a toilet-paper holder positioned within reach of the toilet',
    de: 'ein Toilettenpapierhalter in Reichweite der Toilette',
    it: 'un portarotolo posizionato a portata della toilette',
  },
  'toilet-brush-holder': {
    en: 'a toilet-brush holder for the floor area beside the toilet',
    de: 'ein Toilettenbürstenhalter für den Bodenbereich neben der Toilette',
    it: 'un portascopino per la zona pavimento accanto alla toilette',
  },
  'tumbler-holder': {
    en: 'a tumbler holder beside a basin or mirror',
    de: 'ein Zahnputzbecherhalter neben Waschbecken oder Spiegel',
    it: 'un portabicchiere accanto a lavabo o specchio',
  },
  'soap-dish-holder': {
    en: 'a soap-dish holder at a basin or bath',
    de: 'eine Seifenschale an Waschbecken oder Badewanne',
    it: 'un portasapone vicino a lavabo o vasca',
  },
  'corner-shelf': {
    en: 'a corner shelf for shampoo and shower items in a shower corner',
    de: 'ein Eckregal für Shampoo und Duschutensilien in einer Duschecke',
    it: 'un ripiano angolare per shampoo e prodotti doccia nell’angolo doccia',
  },
  'grab-bar': {
    en: 'a wall-mounted grab bar for an accessible or supported bathroom layout',
    de: 'eine wandmontierte Haltegriffstange für ein barrierefreies oder unterstütztes Bad',
    it: 'una maniglia a parete per un bagno accessibile o con supporto',
  },
};

const seriesLabels = {
  en: (s) => s || '',
  de: (s) => s === '1200 Series' ? '1200-Serie' : s,
  it: (s) => s === '1200 Series' ? 'Serie 1200' : s,
};

function attrMapFor(productId) {
  const map = {};
  for (const row of db.prepare('SELECT * FROM product_attributes WHERE product_id = ?').all(productId)) {
    map[row.attr_key] = row;
  }
  return map;
}

function finishNames(productId) {
  return db.prepare(`
    SELECT f.name_en AS name FROM product_finishes pf
    JOIN finishes f ON f.id = pf.finish_id
    WHERE pf.product_id = ?
    ORDER BY f.sort_order
  `).all(productId).map((row) => row.name);
}

function ensureColumn(table, name, sql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
}

db.exec('BEGIN IMMEDIATE');
try {
  ensureColumn('inquiries', 'is_test', "is_test INTEGER NOT NULL DEFAULT 0");
  db.exec('CREATE INDEX IF NOT EXISTS idx_inquiries_is_test ON inquiries(is_test)');
  db.prepare('UPDATE inquiries SET is_test = 1').run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      product_id INTEGER,
      category_key TEXT,
      source_type TEXT NOT NULL,
      licence TEXT NOT NULL,
      source_url TEXT,
      attribution TEXT,
      prompt TEXT,
      seed TEXT,
      model TEXT,
      ai_generated INTEGER NOT NULL DEFAULT 0,
      shows_product INTEGER NOT NULL DEFAULT 0,
      used_on TEXT,
      status TEXT NOT NULL DEFAULT 'reference_assumption',
      checked_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_image_assets_kind ON image_assets(kind);
  `);

  // Remove placeholder documents; only real approved files may be downloadable.
  const removedDocs = db.prepare("DELETE FROM documents WHERE status = 'pending'").run().changes;
  log('removed pending documents', removedDocs);

  // Warranty is not verified: remove it rather than turning a placeholder into a promise.
  const removedWarranty = db.prepare("DELETE FROM product_attributes WHERE attr_key = 'warranty'").run().changes;
  log('removed warranty attrs', removedWarranty);

  const categoryRows = db.prepare(`
    SELECT c.id, c.key, c.slug, ct.name AS name
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'en'
    WHERE c.published = 1
  `).all();
  const categories = new Map(categoryRows.map((row) => [row.id, row]));

  const products = db.prepare('SELECT * FROM products WHERE published = 1 ORDER BY id').all();
  log('products', products.length);

  // Clean commercial values and create honest status variety.
  for (const product of products) {
    const cat = categories.get(product.category_id);
    const key = cat ? cat.key : '';
    const attrs = attrMapFor(product.id);
    const finishes = finishNames(product.id);
    const set = (keyName, value, status, source = 'reference', note = null) => {
      const existing = attrs[keyName];
      if (!existing) return;
      db.prepare(`
        UPDATE product_attributes
        SET value = ?, status = ?, data_source = ?, source_note = COALESCE(?, source_note), updated_at = ?
        WHERE id = ?
      `).run(value, status, source, note, now, existing.id);
    };

    if (finishes.length) {
      set('finish', finishes.join(' / '), 'reference', 'reference_assumption',
        'Finish list is taken from the SKU-level finish relation; coating and test scope remain unconfirmed.');
    }

    // Categories get materially different packaging/MOQ references.
    const packaging = key === 'grab-bar' || key === 'corner-shelf'
      ? 'Protective film + inner box + master carton; fittings bag included.'
      : key === 'towel-rack' || key === 'double-towel-bar'
        ? 'Protective sleeve + printed inner box + master carton.'
        : 'Individual bag + printed inner box + master carton.';
    set('packaging', packaging, 'reference', 'reference_assumption',
      'Packaging is a reference assumption for quotation; final packing is confirmed per order.');
    const moq = ['robe-hook', 'towel-ring', 'toilet-paper-holder', 'toilet-brush-holder'].includes(key)
      ? '200 pcs per SKU'
      : ['grab-bar', 'corner-shelf'].includes(key)
        ? '100 pcs per SKU'
        : '300 pcs per SKU';
    set('moq', moq, 'reference', 'reference_assumption',
      'MOQ is a reference assumption; confirm with the factory for the exact SKU and finish.');

    set('certification',
      'Compliance scope is confirmed for the destination market and exact SKU; request the product-specific test report. No blanket certificate is claimed.',
      'available_on_request', null,
      'No product-specific certificate is published. This field records the request path, not a certification.');

    set('customization',
      'OEM/ODM: finish, logo, packaging and dimensions subject to feasibility.',
      'customizable', null,
      'Customization is a project capability; feasibility and tooling are confirmed per enquiry.');

    if (product.id % 4 === 0) {
      const price = attrs.price;
      if (price) {
        db.prepare("UPDATE product_attributes SET value = NULL, status = 'available_on_request', data_source = NULL, source_note = ?, updated_at = ? WHERE id = ?")
          .run('Indicative prices are not published for this SKU. Request a quotation.', now, price.id);
      }
    }
    if (product.id % 5 === 0) {
      const pack = attrs.packaging;
      if (pack) {
        db.prepare("UPDATE product_attributes SET status = 'pending_verification', data_source = NULL, source_note = ?, updated_at = ? WHERE id = ?")
          .run('Packaging values conflict between reference sources; confirm before quotation.', now, pack.id);
      }
    }

    // Separate material grade fields.
    const isSteel = String(attrs.material && attrs.material.value || '').toLowerCase().includes('stainless');
    if (isSteel) {
      db.prepare("DELETE FROM product_attributes WHERE product_id = ? AND attr_key = 'brass_grade'").run(product.id);
      if (!db.prepare("SELECT 1 FROM product_attributes WHERE product_id = ? AND attr_key = 'steel_grade'").get(product.id)) {
        db.prepare(`
          INSERT INTO product_attributes (product_id, attr_key, value, unit, status, source_note, data_source, visible_frontend, sort_order, updated_at)
          VALUES (?, 'steel_grade', '304', NULL, 'reference', 'Steel grade is a reference assumption; confirm mill certificate and grade for the exact SKU.', 'reference_assumption', 1, 11, ?)
        `).run(product.id, now);
      }
      db.prepare("UPDATE product_attributes SET value = 'Stainless steel 304', updated_at = ? WHERE product_id = ? AND attr_key = 'material'").run(now, product.id);
    } else {
      db.prepare("DELETE FROM product_attributes WHERE product_id = ? AND attr_key = 'steel_grade'").run(product.id);
      db.prepare("UPDATE product_attributes SET value = 'Brass H59', updated_at = ? WHERE product_id = ? AND attr_key = 'material'").run(now, product.id);
    }
  }

  // Narratives: one unique record per SKU and locale. Values remain reference assumptions.
  const narrativeStmt = db.prepare(`
    UPDATE product_translations
    SET short_description = ?, description = ?, seo_title = ?, seo_description = ?, translation_status = ?
    WHERE product_id = ? AND locale = ?
  `);
  for (const product of products) {
    const cat = categories.get(product.category_id);
    const key = cat ? cat.key : '';
    const attrs = attrMapFor(product.id);
    const finishes = finishNames(product.id);
    const dims = attrs.dimensions && attrs.dimensions.value || 'dimensions to be confirmed';
    const weight = attrs.weight && attrs.weight.value || 'weight to be confirmed';
    const material = attrs.material && attrs.material.value || 'material to be confirmed';
    const moq = attrs.moq && attrs.moq.value || 'MOQ to be confirmed';
    const packaging = attrs.packaging && attrs.packaging.value || 'packaging to be confirmed';
    const lead = attrs.lead_time && attrs.lead_time.value || 'lead time to be confirmed';
    const finish = finishes.length ? finishes.join(' / ') : 'finish to be confirmed';
    const categoryName = cat ? cat.name : (attrs.category_name || 'bathroom hardware');
    const series = seriesLabels.en(product.series);
    const deSeries = seriesLabels.de(product.series);
    const itSeries = seriesLabels.it(product.series);
    const useEn = categoryCopy[key] ? categoryCopy[key].en : 'bathroom hardware for residential and commercial projects';
    const useDe = categoryCopy[key] ? categoryCopy[key].de : 'Badaccessoires für Wohn- und Objektprojekte';
    const useIt = categoryCopy[key] ? categoryCopy[key].it : 'accessori bagno per progetti residenziali e commerciali';

    const enShort = `${product.sku} is ${useEn}; this ${categoryName} record uses a ${dims} reference envelope, ${material} and ${finish}.`;
    const enLong = [
      `${product.sku} belongs to OLANG’s ${series || 'published'} range and is catalogued as ${categoryName}. The reference record pairs a ${dims} envelope with ${material}, ${finish} finish options and a net weight reference of ${weight}. The geometry and finish shown here are reference data until the exact SKU is confirmed.`,
      `For ${product.sku}, the mounting position is the decisive detail: ${useEn}. The model uses a wall-fixed installation reference, while the actual wall structure, fixing kit and required height must be checked for the project. This is a representative application, not a completed OLANG project.`,
      `Procurement data for ${product.sku} is presented as a reference assumption: ${packaging} Packaging, ${moq} MOQ, ${lead} lead time and the requested certification scope are confirmed in the quotation. No blanket certificate or customer reference is claimed; request the product-specific file and a sample before release.`,
    ].join('\n\n');

    const deShort = `${product.sku} ist ${useDe}; der Datensatz für ${categoryName} verwendet ${dims} als Referenz, ${material} und ${finish}.`;
    const deLong = [
      `${product.sku} gehört zur veröffentlichten ${deSeries || 'OLANG'}-Serie und ist als ${categoryName} geführt. Der Referenzdatensatz verbindet ${dims} mit ${material}, ${finish} und einem Netto-Gewichtsbezug von ${weight}. Geometrie und Oberfläche bleiben Referenzannahmen, bis der exakte Artikel bestätigt ist.`,
      `Bei ${product.sku} entscheidet die Montageposition: ${useDe}. Das Modell zeigt eine wandmontierte Referenz; Wandaufbau, Befestigungssatz und Montagehöhe sind projektbezogen zu prüfen. Dies ist eine repräsentative Anwendung, kein abgeschlossenes OLANG-Projekt.`,
      `Beschaffungsdaten für ${product.sku} sind Referenzannahmen: ${packaging} Verpackung, ${moq} MOQ und ${lead} Lieferzeit werden im Angebot bestätigt. Es wird keine pauschale Zertifizierung und kein Kundenreferenzfall behauptet; produktspezifische Unterlagen und ein Muster sind vor Freigabe anzufordern.`,
    ].join('\n\n');

    const itShort = `${product.sku} è ${useIt}; la scheda ${categoryName} usa un riferimento ${dims}, ${material} e ${finish}.`;
    const itLong = [
      `${product.sku} appartiene alla serie ${itSeries || 'OLANG'} pubblicata ed è catalogato come ${categoryName}. Il record di riferimento combina ${dims} con ${material}, finiture ${finish} e un peso netto di riferimento ${weight}. Geometria e finitura restano ipotesi fino alla conferma dell’articolo esatto.`,
      `Per ${product.sku}, la posizione di montaggio è il dato decisivo: ${useIt}. Il modello mostra un montaggio a parete di riferimento; struttura della parete, kit di fissaggio e altezza devono essere verificati sul progetto. Questa è un’applicazione rappresentativa, non un progetto OLANG completato.`,
      `I dati di acquisto di ${product.sku} sono ipotesi di riferimento: ${packaging} imballaggio, ${moq} MOQ e ${lead} tempi vengono confermati nel preventivo. Non si dichiarano certificazioni generali o referenze cliente; richiedere il documento specifico e un campione prima del rilascio.`,
    ].join('\n\n');

    narrativeStmt.run(enShort, enLong,
      `${product.sku} ${categoryName} | OLANG`,
      `${product.sku} ${categoryName}: reference dimensions, material, finish and procurement fields; request the exact specification and quotation.`,
      'reviewed', product.id, 'en');
    narrativeStmt.run(deShort, deLong,
      `${product.sku} ${categoryName} | OLANG`,
      `${product.sku} ${categoryName}: Referenzmaße, Werkstoff, Oberfläche und Beschaffungsfelder; exakte Spezifikation und Angebot anfordern.`,
      'ai_draft', product.id, 'de');
    narrativeStmt.run(itShort, itLong,
      `${product.sku} ${categoryName} | OLANG`,
      `${product.sku} ${categoryName}: dimensioni, materiale, finitura e dati di acquisto di riferimento; richiedere specifica e preventivo esatti.`,
      'ai_draft', product.id, 'it');
  }

  // Image asset registry for product, detail and category scene images.
  const insertAsset = db.prepare(`
    INSERT INTO image_assets
      (path, kind, product_id, category_key, source_type, licence, source_url, attribution, prompt, seed, model,
       ai_generated, shows_product, used_on, status, checked_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, 'reference_assumption', ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      kind=excluded.kind, product_id=excluded.product_id, category_key=excluded.category_key,
      source_type=excluded.source_type, licence=excluded.licence, source_url=excluded.source_url,
      shows_product=excluded.shows_product, used_on=excluded.used_on, checked_at=excluded.checked_at,
      notes=excluded.notes, updated_at=excluded.updated_at
  `);
  for (const product of products) {
    const cat = categories.get(product.category_id);
    const productImage = product.image_path ? '/' + product.image_path.replace(/^\/+/, '') : '';
    if (productImage) {
      insertAsset.run(productImage, 'product', product.id, cat ? cat.key : null,
        'olang_public', 'OLANG public product page; company permission required for commercial reuse',
        product.source_url || null, 'OLANG public product page', 1,
        `/products/${product.slug}`, now,
        'Real product image. Original source may contain an OLANG watermark; no third-party image is implied.',
        now, now);
    }
    const detail = `/images/products/detail/${product.sku.toLowerCase()}.jpg`;
    if (fs.existsSync(path.join(PUBLIC, detail.slice(1)))) {
      insertAsset.run(detail, 'detail', product.id, cat ? cat.key : null,
        'derived_crop', 'Derived from OLANG public product image; company permission required for commercial reuse',
        product.source_url || null, 'Crop of the OLANG public product image', 1,
        `/products/${product.slug}`, now,
        'Detail crop, not a back-view or engineering drawing. Back/mounting photo still to be supplied by the company.',
        now, now);
    }
  }
  for (const cat of categoryRows) {
    const scenePath = `/images/scenes/categories/${cat.key}.jpg`;
    if (!fs.existsSync(path.join(PUBLIC, scenePath.slice(1)))) continue;
    const first = products.find((product) => product.category_id === cat.id);
    insertAsset.run(scenePath, 'scene', first ? first.id : null, cat.key,
      'composite_pexels_olang',
      'Licensed Pexels interior + OLANG public product cutout; composite made for this project',
      'https://www.pexels.com/license/',
      'Pexels interior photograph; OLANG public product image cutout; project composite',
      1, `/products?category=${cat.slug}`, now,
      'Representative scene composite. Product is visible but is not a project photograph; installation, wall structure and exact SKU remain subject to company confirmation.',
      now, now);
  }

  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .run('remediation.v4_applied_at', now, now);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
log('complete at', now);
db.close();

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { hashPassword } = require('../auth/passwords');
const { nowIso } = require('../lib/util');
const { getSetting, setSetting } = require('../services/settings');
const { seedCatalogue } = require('./catalog-seed');
const { seedHonestData } = require('./honest-data');
const { seedColors } = require('./color-seed');
const { seedEditorial } = require('./editorial-seed');

const CATEGORIES = [
  { key: 'robe-hook', slug: 'robe-hooks', en: 'Robe Hooks', de: 'Bademantelhaken', it: 'Ganci portaccappatoio' },
  { key: 'towel-ring', slug: 'towel-rings', en: 'Towel Rings', de: 'Handtuchringe', it: 'Anelli portasciugamani' },
  { key: 'single-towel-bar', slug: 'single-towel-bars', en: 'Single Towel Bars', de: 'Einzelne Handtuchstangen', it: 'Portasciugamani singoli' },
  { key: 'double-towel-bar', slug: 'double-towel-bars', en: 'Double Towel Bars', de: 'Doppelte Handtuchstangen', it: 'Portasciugamani doppi' },
  { key: 'toilet-paper-holder', slug: 'toilet-paper-holders', en: 'Toilet Paper Holders', de: 'Toilettenpapierhalter', it: 'Portarotolo' },
  { key: 'tumbler-holder', slug: 'tumbler-holders', en: 'Tumbler Holders', de: 'Zahnputzbecherhalter', it: 'Portabicchieri' },
  { key: 'grab-bar', slug: 'grab-bars', en: 'Grab Bars', de: 'Haltestangen', it: 'Maniglioni' },
  { key: 'corner-shelf', slug: 'corner-shelves', en: 'Corner Shelves', de: 'Eckregale', it: 'Ripiani angolari' },
];

const FINISHES = [
  { code: 'chrome', en: 'Chrome', de: 'Chrom', it: 'Cromo' },
  { code: 'brushed-gold', en: 'Brushed Gold', de: 'Gebürstetes Gold', it: 'Oro spazzolato' },
  { code: 'matte-black', en: 'Matte Black', de: 'Mattschwarz', it: 'Nero opaco' },
];

const PRODUCTS = [
  {
    sku: 'OL-1204', slug: 'robe-hook-ol-1204', category: 'robe-hook', series: '1200 Series',
    image: 'images/products/robe-hook-ol-1204.jpg', source: 'https://en.olang.cn/ProductDetail/21.html',
    en: {
      name: 'Robe Hook', short: 'A wall-mounted hook from the 1200 series for robes, towels and clothing.',
      description: 'A single wall-mounted robe hook in the 1200 family. The shape is intended for robes, towels and light clothing in bathrooms, guest rooms and commercial washrooms. Dimensions, material grade, fixing method and load information are confirmed per SKU before quotation; public OLANG pages do not publish them.',
    },
    de: {
      name: 'Bademantelhaken', short: 'Ein Wandhaken aus der 1200-Serie für Bademäntel, Handtücher und Kleidung.',
      description: 'Ein einzelner Wandhaken aus der 1200-Familie für Bademäntel, Handtücher und leichte Kleidung in Bädern, Gästezimmern und gewerblichen Sanitärbereichen. Maße, Werkstoffgüte, Befestigung und Belastbarkeit werden vor der Angebotserstellung je Artikel bestätigt; die öffentlichen OLANG-Seiten enthalten diese Angaben nicht.',
    },
    it: {
      name: 'Gancio portaccappatoio', short: 'Gancio da parete della serie 1200 per accappatoi, asciugamani e abbigliamento.',
      description: 'Gancio singolo da parete della famiglia 1200, destinato ad accappatoi, asciugamani e capi leggeri in bagni, camere e servizi commerciali. Dimensioni, qualità del materiale, fissaggio e portata vengono confermati per articolo prima del preventivo; le pagine pubbliche OLANG non riportano questi dati.',
    },
  },
  {
    sku: 'OL-1205', slug: 'towel-ring-ol-1205', category: 'towel-ring', series: '1200 Series',
    image: 'images/products/towel-ring-ol-1205.jpg', source: 'https://en.olang.cn/ProductDetail/29.html',
    en: {
      name: 'Towel Ring', short: 'A wall-mounted hand-towel ring in the 1200 series.',
      description: 'A wall-mounted hand-towel ring in the 1200 family. The open ring keeps a hand towel within reach and is suited to bathrooms, guest rooms and hospitality projects. Diameter, material grade, fixing and packing are confirmed per SKU; published finish names are company-provided and not independently tested.',
    },
    de: {
      name: 'Handtuchring', short: 'Ein wandmontierter Handtuchring aus der 1200-Serie.',
      description: 'Ein wandmontierter Handtuchring aus der 1200-Familie. Der offene Ring hält ein Handtuch griffbereit und eignet sich für Bäder, Gästezimmer und Hotelprojekte. Durchmesser, Werkstoffgüte, Befestigung und Verpackung werden je Artikel bestätigt; die veröffentlichten Oberflächenbezeichnungen stammen vom Unternehmen und wurden nicht unabhängig geprüft.',
    },
    it: {
      name: 'Anello portasciugamani', short: 'Anello portasciugamani da parete della serie 1200.',
      description: 'Anello portasciugamani da parete della famiglia 1200. L’anello aperto tiene l’asciugamani a portata di mano ed è adatto a bagni, camere e progetti alberghieri. Diametro, qualità del materiale, fissaggio e imballaggio vengono confermati per articolo; i nomi delle finiture pubblicati sono forniti dall’azienda e non sono stati verificati in modo indipendente.',
    },
  },
  {
    sku: 'OL-1208', slug: 'single-towel-bar-ol-1208', category: 'single-towel-bar', series: '1200 Series',
    image: 'images/products/single-towel-bar-ol-1208.jpg', source: 'https://en.olang.cn/ProductDetail/73.html',
    en: {
      name: 'Single Towel Bar', short: 'A single-rail wall-mounted towel bar in the 1200 series.',
      description: 'A single-rail towel bar in the 1200 family for bathrooms and guest rooms. Bar length, projection from the wall, material grade, fixing and carton data are confirmed per SKU. Plan the mounting surface and load requirements with the specification sheet before ordering.',
    },
    de: {
      name: 'Handtuchstange, einteilig', short: 'Eine einteilige, wandmontierte Handtuchstange aus der 1200-Serie.',
      description: 'Eine einteilige Handtuchstange aus der 1200-Familie für Bäder und Gästezimmer. Länge, Wandabstand, Werkstoffgüte, Befestigung und Kartondaten werden je Artikel bestätigt. Montagefläche und Belastungsanforderungen sollten vor der Bestellung anhand des Datenblatts geprüft werden.',
    },
    it: {
      name: 'Portasciugamani singolo', short: 'Portasciugamani a barra singola da parete della serie 1200.',
      description: 'Portasciugamani a barra singola della famiglia 1200 per bagni e camere. Lunghezza, sporgenza dalla parete, qualità del materiale, fissaggio e dati del cartone vengono confermati per articolo. Prima dell’ordine, verificare la superficie di montaggio e i requisiti di carico con la scheda tecnica.',
    },
  },
  {
    sku: 'OL-1209', slug: 'double-towel-bar-ol-1209', category: 'double-towel-bar', series: '1200 Series',
    image: 'images/products/double-towel-bar-ol-1209.jpg', source: 'https://en.olang.cn/ProductDetail/81.html',
    en: {
      name: 'Double Towel Bar', short: 'A two-rail wall-mounted towel bar in the 1200 series.',
      description: 'A two-rail towel bar in the 1200 family designed for bathrooms with limited wall space. Rail spacing, overall dimensions, material grade, fixing and packing are confirmed per SKU. The wall type and anchor selection must be verified for the installation.',
    },
    de: {
      name: 'Handtuchstange, doppelt', short: 'Eine doppelte, wandmontierte Handtuchstange aus der 1200-Serie.',
      description: 'Eine doppelte Handtuchstange aus der 1200-Familie für Bäder mit begrenzter Wandfläche. Stangenabstand, Gesamtmaße, Werkstoffgüte, Befestigung und Verpackung werden je Artikel bestätigt. Wandbeschaffenheit und Dübelauswahl sind für die Montage gesondert zu prüfen.',
    },
    it: {
      name: 'Portasciugamani doppio', short: 'Portasciugamani a doppia barra da parete della serie 1200.',
      description: 'Portasciugamani a doppia barra della famiglia 1200, pensato per bagni con spazio limitato. Distanza tra le barre, dimensioni complessive, qualità del materiale, fissaggio e imballaggio vengono confermati per articolo. Il tipo di parete e i tasselli devono essere verificati per l’installazione.',
    },
  },
  {
    sku: 'OL-1706B', slug: 'toilet-paper-holder-ol-1706b', category: 'toilet-paper-holder', series: '1700 Series',
    image: 'images/products/tissue-holder-ol-1706b.jpg', source: 'https://en.olang.cn/ProductDetail/35.html',
    en: {
      name: 'Toilet Paper Holder', short: 'A wall-mounted tissue holder from the 1700 series.',
      description: 'A wall-mounted toilet paper holder in the 1700 family. Spindle type, overall dimensions, material grade, fixing and packing are confirmed per SKU. Confirm the roll format and mounting position for the intended market and installation.',
    },
    de: {
      name: 'Toilettenpapierhalter', short: 'Ein wandmontierter Toilettenpapierhalter aus der 1700-Serie.',
      description: 'Ein wandmontierter Toilettenpapierhalter aus der 1700-Familie. Achsentyp, Gesamtmaße, Werkstoffgüte, Befestigung und Verpackung werden je Artikel bestätigt. Rollenformat und Montageposition sollten für den Zielmarkt und die jeweilige Installation geprüft werden.',
    },
    it: {
      name: 'Portarotolo', short: 'Portarotolo da parete della serie 1700.',
      description: 'Portarotolo da parete della famiglia 1700. Tipo di perno, dimensioni complessive, qualità del materiale, fissaggio e imballaggio vengono confermati per articolo. Verificare il formato del rotolo e la posizione di montaggio in base al mercato e all’installazione.',
    },
  },
  {
    sku: 'OL-6602', slug: 'tumbler-holder-ol-6602', category: 'tumbler-holder', series: '6600 Series',
    image: 'images/products/tumbler-holder-ol-6602.jpg', source: 'https://en.olang.cn/ProductDetail/17.html',
    en: {
      name: 'Tumbler Holder', short: 'A wall-mounted single tumbler holder from the 6600 series.',
      description: 'A wall-mounted holder for a single bathroom tumbler, from the 6600 family. Cup diameter, material grade, fixing method and packing are confirmed per SKU. The item is supplied as the holder only unless the order specification states otherwise.',
    },
    de: {
      name: 'Zahnputzbecherhalter', short: 'Ein wandmontierter Halter für einen Zahnputzbecher aus der 6600-Serie.',
      description: 'Ein wandmontierter Halter für einen einzelnen Zahnputzbecher aus der 6600-Familie. Becherdurchmesser, Werkstoffgüte, Befestigung und Verpackung werden je Artikel bestätigt. Sofern die Auftragsspezifikation nichts anderes vorsieht, wird nur der Halter geliefert.',
    },
    it: {
      name: 'Portabicchiere', short: 'Portabicchiere singolo da parete della serie 6600.',
      description: 'Portabicchiere singolo da parete della famiglia 6600. Diametro del bicchiere, qualità del materiale, fissaggio e imballaggio vengono confermati per articolo. Salvo diversa indicazione nella specifica d’ordine, viene fornito solo il portabicchiere.',
    },
  },
  {
    sku: 'OL-1160', slug: 'grab-bar-ol-1160', category: 'grab-bar', series: null,
    image: 'images/products/grab-bar-ol-1160.jpg', source: 'https://en.olang.cn/ProductDetail/96.html',
    en: {
      name: 'Shower Grab Bar', short: 'A wall-mounted support bar for bathroom safety applications.',
      description: 'A wall-mounted grab bar for bathroom safety and accessible installations. Load rating, anchor type, bar diameter, material grade and applicable standards are confirmed for the specific product, wall construction and destination market. A grab bar must not be specified as ADA-compliant or equivalent without the matching product-level evidence.',
    },
    de: {
      name: 'Haltestange für das Bad', short: 'Eine wandmontierte Haltestange für Sicherheitsanwendungen im Bad.',
      description: 'Eine wandmontierte Haltestange für Sicherheits- und barrierefreie Installationen im Bad. Belastbarkeit, Befestigungsart, Stangendurchmesser, Werkstoffgüte und anwendbare Normen werden für das konkrete Produkt, die Wandkonstruktion und den Zielmarkt bestätigt. Eine Haltestange darf nicht als ADA-konform oder gleichwertig angeboten werden, solange kein produktspezifischer Nachweis vorliegt.',
    },
    it: {
      name: 'Maniglione di sostegno', short: 'Maniglione da parete per applicazioni di sicurezza in bagno.',
      description: 'Maniglione da parete per installazioni di sicurezza e accessibilità in bagno. Portata, tipo di fissaggio, diametro, qualità del materiale e norme applicabili vengono confermati per il prodotto specifico, il tipo di parete e il mercato di destinazione. Un maniglione non può essere dichiarato conforme ADA o equivalente senza una prova specifica del prodotto.',
    },
  },
  {
    sku: 'OL-5201B', slug: 'corner-shelf-ol-5201b', category: 'corner-shelf', series: null,
    image: 'images/products/corner-shelf-ol-5201b.jpg', source: 'https://en.olang.cn/ProductDetail/137.html',
    en: {
      name: 'Corner Shelf', short: 'A wall-mounted corner shelf for bathroom storage.',
      description: 'A wall-mounted corner shelf for bathroom storage. Shelf dimensions, material grade, load rating, fixing method and packing are confirmed per SKU. Confirm the wall construction, intended load and cleaning chemicals with the specification before ordering.',
    },
    de: {
      name: 'Eckregal', short: 'Ein wandmontiertes Eckregal für Stauraum im Bad.',
      description: 'Ein wandmontiertes Eckregal für Stauraum im Bad. Regalmaße, Werkstoffgüte, Belastbarkeit, Befestigung und Verpackung werden je Artikel bestätigt. Wandbeschaffenheit, vorgesehene Belastung und Reinigungschemikalien sollten vor der Bestellung anhand der Spezifikation geprüft werden.',
    },
    it: {
      name: 'Ripiano angolare', short: 'Ripiano angolare da parete per riporre oggetti in bagno.',
      description: 'Ripiano angolare da parete per il bagno. Dimensioni, qualità del materiale, portata, fissaggio e imballaggio vengono confermati per articolo. Prima dell’ordine, verificare la struttura della parete, il carico previsto e i prodotti detergenti utilizzati.',
    },
  },
];

const ATTRS = [
  'material', 'brass_grade', 'dimensions', 'weight', 'finish', 'installation',
  'included_accessories', 'applicable_environment', 'moq', 'lead_time',
  'packaging', 'inner_box', 'master_carton', 'customization', 'private_label',
  'certification', 'price', 'warranty',
];

const FAQS = [
  {
    key: 'manufacturer',
    en: ['Is OLANG a manufacturer or a trading company?', 'OLANG’s public company profile describes a Foshan-based bathroom hardware manufacturer. This website reproduces that self-description and marks it as company-reported. Company registration, factory audit documents and current production evidence are available only after OLANG confirms them.'],
    de: ['Ist OLANG Hersteller oder Händler?', 'Das öffentliche Unternehmensprofil von OLANG beschreibt ein in Foshan ansässiges Unternehmen für Badaccessoires. Diese Website gibt diese Selbstauskunft wieder und kennzeichnet sie als Unternehmensangabe. Handelsregisterauszug, Werkprüfungen und aktuelle Produktionsnachweise können erst nach Bestätigung durch OLANG bereitgestellt werden.'],
    it: ['OLANG è un produttore o un intermediario commerciale?', 'Il profilo pubblico di OLANG descrive un’azienda con sede a Foshan specializzata in accessori per bagno. Questo sito riporta tale autodescrizione e la contrassegna come dichiarazione aziendale. Visura, audit di fabbrica e prove di produzione aggiornate possono essere forniti solo dopo conferma da parte di OLANG.'],
  },
  {
    key: 'moq',
    en: ['What is the MOQ?', 'A verified MOQ is not published for these SKUs. MOQ is confirmed per product, finish and order mix after the buying list is reviewed. The inquiry form lets you provide target quantities so the team can respond with a specific answer rather than a generic figure.'],
    de: ['Wie hoch ist die Mindestbestellmenge?', 'Für diese Artikel ist keine geprüfte Mindestbestellmenge veröffentlicht. Die Mindestmenge wird je Produkt, Oberfläche und Auftragsmix nach Prüfung der Bestellliste bestätigt. Im Anfrageformular können Sie Zielmengen angeben, damit das Team konkret statt pauschal antworten kann.'],
    it: ['Qual è il quantitativo minimo d’ordine?', 'Per questi articoli non è pubblicato un quantitativo minimo verificato. Il minimo viene confermato per prodotto, finitura e mix d’ordine dopo la verifica della lista d’acquisto. Nel modulo è possibile indicare le quantità previste per ricevere una risposta specifica.'],
  },
  {
    key: 'samples',
    en: ['Can I request a sample?', 'Sample availability, sample cost and courier arrangements are not published. Submit the product, finish, quantity and destination details; the team will confirm whether a sample can be supplied and on what terms.'],
    de: ['Kann ich ein Muster anfordern?', 'Verfügbarkeit, Kosten und Versand von Mustern sind nicht veröffentlicht. Senden Sie Produkt, Oberfläche, Menge und Zielort; das Team bestätigt, ob und zu welchen Bedingungen ein Muster bereitgestellt werden kann.'],
    it: ['È possibile richiedere un campione?', 'Disponibilità, costo e spedizione dei campioni non sono pubblicati. Indicare prodotto, finitura, quantità e destinazione; il team confermerà se e a quali condizioni è possibile fornire un campione.'],
  },
  {
    key: 'customization',
    en: ['Can you customize finish, logo or packaging?', 'OLANG publicly describes OEM/ODM and private-label support. This website does not claim that every SKU or process is available for customization. Submit the target product, changes, quantities and market; feasibility, tooling, MOQ and timing are confirmed in writing.'],
    de: ['Sind Oberfläche, Logo oder Verpackung individualisierbar?', 'OLANG beschreibt öffentlich OEM/ODM- und Private-Label-Unterstützung. Diese Website behauptet nicht, dass jeder Artikel oder Prozess individualisierbar ist. Senden Sie Zielprodukt, Änderungen, Mengen und Markt; Machbarkeit, Werkzeuge, Mindestmenge und Zeitplan werden schriftlich bestätigt.'],
    it: ['È possibile personalizzare finitura, logo o imballaggio?', 'OLANG descrive pubblicamente il supporto OEM/ODM e private label. Questo sito non dichiara che ogni articolo o processo sia personalizzabile. Indicare prodotto, modifiche, quantità e mercato; fattibilità, attrezzature, minimo e tempi vengono confermati per iscritto.'],
  },
  {
    key: 'certification',
    en: ['Are the products certified for my market?', 'No blanket certification is claimed. CE, UKCA, WaterMark, ADA, WRAS, REACH or other requirements apply to specific products and markets. Any statement must be supported by a valid document covering the exact SKU. Use the document request to ask for the compliance scope.'],
    de: ['Sind die Produkte für meinen Markt zertifiziert?', 'Es wird keine pauschale Zertifizierung behauptet. CE, UKCA, WaterMark, ADA, WRAS, REACH und andere Anforderungen gelten für bestimmte Produkte und Märkte. Jede Aussage muss durch ein gültiges Dokument für den exakten Artikel belegt sein. Fordern Sie den Compliance-Umfang über die Dokumentenanfrage an.'],
    it: ['I prodotti sono certificati per il mio mercato?', 'Non viene dichiarata una certificazione generalizzata. CE, UKCA, WaterMark, ADA, WRAS, REACH e altri requisiti si applicano a prodotti e mercati specifici. Ogni dichiarazione deve essere supportata da un documento valido riferito all’articolo esatto. Richiedere l’ambito di conformità tramite la richiesta documenti.'],
  },
  {
    key: 'prices',
    en: ['Why are prices not shown?', 'These products are quoted against specification, quantity, finish, packing and delivery terms. No verified public price list is available, so showing a template price would be misleading. Submit a buying list and the team will quote the exact configuration.'],
    de: ['Warum sind keine Preise angegeben?', 'Diese Produkte werden nach Spezifikation, Menge, Oberfläche, Verpackung und Lieferbedingungen angeboten. Eine geprüfte öffentliche Preisliste liegt nicht vor; ein Vorlagenpreis wäre irreführend. Senden Sie eine Bestellliste, und das Team kalkuliert die konkrete Konfiguration.'],
    it: ['Perché non sono indicati i prezzi?', 'Questi prodotti sono quotati in base a specifica, quantità, finitura, imballaggio e condizioni di consegna. Non esiste un listino pubblico verificato; mostrare un prezzo modello sarebbe fuorviante. Inviare una lista d’acquisto per ricevere un preventivo sulla configurazione esatta.'],
  },
  {
    key: 'documents',
    en: ['How do I get a specification sheet?', 'Specification sheets are released per SKU and can require review by the company. Add the product model and requested document in the document request form. Public downloads are shown only when a real file has been uploaded and approved; no placeholder PDF links are used.'],
    de: ['Wie erhalte ich ein technisches Datenblatt?', 'Datenblätter werden je Artikel bereitgestellt und können eine Prüfung durch das Unternehmen erfordern. Geben Sie Modell und gewünschtes Dokument im Formular für Dokumentenanfragen an. Öffentliche Downloads erscheinen nur, wenn eine echte Datei freigegeben wurde; Platzhalter-PDFs werden nicht verwendet.'],
    it: ['Come posso ottenere una scheda tecnica?', 'Le schede tecniche vengono fornite per singolo articolo e possono richiedere una verifica aziendale. Indicare modello e documento richiesto nel modulo di richiesta documenti. I download pubblici compaiono solo quando un file reale è stato approvato; non vengono usati PDF segnaposto.'],
  },
  {
    key: 'drawings',
    en: ['Can I upload a drawing or confidential file?', 'Yes, but share only what is necessary. Uploads are stored outside the public web root and are visible only to authorised staff. If the drawing is confidential, request an NDA before uploading. Files are type/size checked, but this deployment does not claim antivirus scanning.'],
    de: ['Kann ich eine Zeichnung oder vertrauliche Datei hochladen?', 'Ja, aber teilen Sie nur die notwendigen Unterlagen. Uploads werden außerhalb des öffentlichen Webverzeichnisses gespeichert und sind nur für autorisierte Mitarbeitende sichtbar. Bei vertraulichen Zeichnungen fordern Sie vor dem Upload eine NDA an. Dateityp und Größe werden geprüft; ein Virenscan wird in dieser Umgebung nicht zugesichert.'],
    it: ['Posso caricare un disegno o un file riservato?', 'Sì, ma condividere solo quanto necessario. I file caricati sono conservati fuori dalla directory pubblica e visibili solo al personale autorizzato. Per disegni riservati, richiedere un NDA prima del caricamento. Tipo e dimensione sono verificati; questa installazione non dichiara l’esecuzione di antivirus.'],
  },
  {
    key: 'leadtime',
    en: ['What is the lead time?', 'No verified production or delivery lead time is published. It depends on the SKU, finish, quantity, packing and shipping route. The team confirms timing after reviewing the specification and destination.'],
    de: ['Wie lang ist die Lieferzeit?', 'Es ist keine geprüfte Produktions- oder Lieferzeit veröffentlicht. Sie hängt von Artikel, Oberfläche, Menge, Verpackung und Transportweg ab. Das Team bestätigt den Zeitplan nach Prüfung von Spezifikation und Zielort.'],
    it: ['Qual è il tempo di consegna?', 'Non è pubblicato un tempo di produzione o consegna verificato. Dipende da articolo, finitura, quantità, imballaggio e percorso di spedizione. Il team conferma i tempi dopo aver esaminato specifica e destinazione.'],
  },
];

function seedCategories(db) {
  const now = nowIso();
  const insertCategory = db.prepare(`
    INSERT INTO categories (key, slug, sort_order, published, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  const insertTranslation = db.prepare(`
    INSERT INTO category_translations (category_id, locale, name, description)
    VALUES (?, ?, ?, '')
    ON CONFLICT(category_id, locale) DO NOTHING
  `);
  CATEGORIES.forEach((category, index) => {
    insertCategory.run(category.key, category.slug, index + 1, now, now);
    const row = db.prepare('SELECT id FROM categories WHERE key = ?').get(category.key);
    if (row) {
      insertTranslation.run(row.id, 'en', category.en);
      insertTranslation.run(row.id, 'de', category.de);
      insertTranslation.run(row.id, 'it', category.it);
    }
  });
}

function seedFinishes(db) {
  const insert = db.prepare(`
    INSERT INTO finishes (code, name_en, name_de, name_it, sort_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `);
  FINISHES.forEach((finish, index) => insert.run(finish.code, finish.en, finish.de, finish.it, index + 1));
}

function seedProducts(db) {
  const now = nowIso();
  const insertProduct = db.prepare(`
    INSERT INTO products (sku, slug, category_id, series, image_path, published, sort_order, source_url, source_checked_at, source_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, '2026-11-07', ?, ?, ?)
    ON CONFLICT(sku) DO NOTHING
  `);
  const insertTranslation = db.prepare(`
    INSERT INTO product_translations (product_id, locale, name, short_description, description, seo_title, seo_description, translation_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, locale) DO NOTHING
  `);
  const insertAttr = db.prepare(`
    INSERT INTO product_attributes (product_id, attr_key, value, unit, status, source_note, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, attr_key) DO NOTHING
  `);
  const insertFinish = db.prepare(`
    INSERT INTO product_finishes (product_id, finish_id, status, note)
    VALUES (?, ?, 'reference', ?)
    ON CONFLICT(product_id, finish_id) DO NOTHING
  `);

  PRODUCTS.forEach((product, index) => {
    const category = db.prepare('SELECT id FROM categories WHERE key = ?').get(product.category);
    if (!category) return;
    insertProduct.run(
      product.sku, product.slug, category.id, product.series, product.image, index + 1,
      product.source,
      'Product name/model/series/category reproduced from the public OLANG product page accessed 2026-11-07. Material and procurement fields are not published there.',
      now, now,
    );
    const row = db.prepare('SELECT id FROM products WHERE sku = ?').get(product.sku);
    if (!row) return;
    const id = row.id;
    const nameEn = product.en.name;
    insertTranslation.run(id, 'en', nameEn, product.en.short, product.en.description,
      `${nameEn} ${product.sku} | OLANG Bathroom Hardware`,
      `${nameEn} ${product.sku} from OLANG. Review published specifications, request the SKU specification sheet and submit a buying list.`.slice(0, 300),
      'reviewed');
    insertTranslation.run(id, 'de', product.de.name, product.de.short, product.de.description,
      `${product.de.name} ${product.sku} | OLANG`,
      `${product.de.name} ${product.sku} von OLANG. Technische Angaben prüfen, Datenblatt anfordern und Bestellliste senden.`.slice(0, 300),
      'ai_draft');
    insertTranslation.run(id, 'it', product.it.name, product.it.short, product.it.description,
      `${product.it.name} ${product.sku} | OLANG`,
      `${product.it.name} ${product.sku} di OLANG. Consultare i dati pubblicati, richiedere la scheda tecnica e inviare la lista d’acquisto.`.slice(0, 300),
      'ai_draft');

    ATTRS.forEach((key, attrIndex) => {
      let value = null;
      let status = 'available_on_request';
      let note = 'Not published on the public OLANG page; confirm with the company before quoting.';
      if (key === 'finish') {
        value = FINISHES.map((f) => f.en).join(', ');
        status = 'reference';
        note = 'Colour names are visible on the public product page. Coating standard, thickness and test results are not published.';
      }
      if (key === 'material') {
        status = 'pending_verification';
        note = 'Public OLANG product descriptions reference stainless steel while the company positioning references brass. Material grade must be verified per SKU.';
      }
      if (key === 'certification') {
        status = 'pending_verification';
        note = 'No product-level certificate or test report is published. Do not claim certification without a valid document covering this SKU and market.';
      }
      if (key === 'price') {
        status = 'available_on_request';
        note = 'No verified public price list. Quote only against confirmed specification and quantity.';
      }
      insertAttr.run(id, key, value, null, status, note, attrIndex, now);
    });

    FINISHES.forEach((finish) => {
      const finishRow = db.prepare('SELECT id FROM finishes WHERE code = ?').get(finish.code);
      if (finishRow) {
        insertFinish.run(id, finishRow.id, 'Finish name visible on the public product page; no coating standard or test report was published.');
      }
    });
  });
}

function seedDocuments(db) {
  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO documents (title, doc_type, product_id, category_id, version, language, markets, visibility, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'en', ?, 'request', 'pending', ?, ?, ?)
  `);
  const exists = db.prepare(`
    SELECT 1 FROM documents WHERE doc_type = ? AND product_id IS ? AND title = ?
  `);
  const products = db.prepare('SELECT id, sku FROM products ORDER BY sort_order').all();
  for (const product of products) {
    const docs = [
      ['spec_sheet', `${product.sku} Product Specification Sheet`, 'Specification metadata only. No file has been supplied or approved by OLANG. The request form records the buyer request.'],
      ['installation', `${product.sku} Installation Instructions`, 'No installation file has been supplied. Fixing method and included parts require company confirmation.'],
      ['packaging', `${product.sku} Packaging Specification`, 'Inner box, master carton and carton-mark details are not published. Request confirmation for the order.'],
    ];
    for (const [docType, title, notes] of docs) {
      if (exists.get(docType, product.id, title)) continue;
      insert.run(
        title, docType, product.id, null, 'Not published',
        JSON.stringify(['global', 'en-us', 'en-au', 'en-gb', 'de', 'it']), notes, now, now,
      );
    }
  }
  const globalDocs = [
    ['catalogue', 'Product Catalogue — availability to be confirmed', 'A complete catalogue has not been supplied. No placeholder PDF is linked.'],
    ['test_report', 'Product Test Reports and Certification Scope', 'No product-level test report or certificate is available. Scope must be confirmed per SKU and market.'],
    ['oem', 'OEM / ODM Capability Statement', 'OEM/ODM capability details, tooling policy, MOQ and sample terms are confirmed per project. Request a written capability statement.'],
  ];
  for (const [docType, title, notes] of globalDocs) {
    if (exists.get(docType, null, title)) continue;
    insert.run(
      title, docType, null, null, 'Not published',
      JSON.stringify(['global', 'en-us', 'en-au', 'en-gb', 'de', 'it']), notes, now, now,
    );
  }
}

function seedFaqs(db) {
  const now = nowIso();
  const insertFaq = db.prepare(`
    INSERT INTO faqs (key, sort_order, published, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  const insertTranslation = db.prepare(`
    INSERT INTO faq_translations (faq_id, locale, question, answer, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(faq_id, locale) DO NOTHING
  `);
  FAQS.forEach((faq, index) => {
    insertFaq.run(faq.key, index + 1, now, now);
    const row = db.prepare('SELECT id FROM faqs WHERE key = ?').get(faq.key);
    if (!row) return;
    insertTranslation.run(row.id, 'en', faq.en[0], faq.en[1], 'reviewed');
    insertTranslation.run(row.id, 'de', faq.de[0], faq.de[1], 'ai_draft');
    insertTranslation.run(row.id, 'it', faq.it[0], faq.it[1], 'ai_draft');
  });
}

function seedSettings(db) {
  if (!getSetting(db, 'security.ip_hash_salt')) {
    setSetting(db, 'security.ip_hash_salt', crypto.randomBytes(24).toString('base64url'));
  }
  if (!getSetting(db, 'analytics.baseline_started_at')) {
    setSetting(db, 'analytics.baseline_started_at', nowIso());
  }
  if (!getSetting(db, 'site.demo_mode', null)) {
    setSetting(db, 'site.demo_mode', config.isDemo ? '1' : '0');
  }
  if (!getSetting(db, 'inquiry.reply_sla', null)) {
    setSetting(db, 'inquiry.reply_sla', '2 business days');
  }
}

function seedAdmin(db, log = console) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c > 0) return null;
  const username = config.admin.username;
  const generated = !config.admin.password;
  const password = generated
    ? `Ol-${crypto.randomBytes(12).toString('base64url')}9`
    : config.admin.password;
  const now = nowIso();
  db.prepare(`
    INSERT INTO users (username, email, display_name, password_hash, role, active, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'super_admin', 1, ?, ?, ?)
  `).run(username, config.admin.email || null, 'Portal administrator', hashPassword(password), generated ? 1 : 0, now, now);
  const account = { username, password, generated };
  if (generated) {
    const dir = process.env.OLANG_SECRET_DIR || path.resolve(config.root, 'storage');
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, 'bootstrap-admin.txt');
    const payload = `OLANG initial administrator\nusername: ${username}\npassword: ${password}\nGenerated: ${now}\nChange this password after first login.\n`;
    try {
      fs.writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      file = path.join(dir, `bootstrap-admin-${Date.now()}.txt`);
      fs.writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    log.warn(`[bootstrap] admin account created. One-time credential file: ${file}`);
    log.warn('[bootstrap] Change the password immediately after first login.');
  } else {
    log.info(`[bootstrap] admin account created for username "${username}" from ADMIN_INITIAL_PASSWORD.`);
  }
  return account;
}

function seedAll(db, log = console) {
  seedSettings(db);
  seedCategories(db);
  seedFinishes(db);
  const catalogue = seedCatalogue(db, log);
  seedColors(db, log);
  seedEditorial(db, log);
  seedHonestData(db, log);
  seedDocuments(db);
  try {
    const { applyDemoSpecs } = require('./migrations/2026-11-17-07-demo-specs');
    const { ensureDemoDocuments } = require('../lib/demo-documents');
    applyDemoSpecs(db);
    require('./migrations/2026-11-17-09-ol1205-name').apply(db);
    ensureDemoDocuments(db);
  } catch (error) {
    log.warn?.(`[demo data] ${error.message}`);
  }
  seedFaqs(db);
  const admin = seedAdmin(db, log);
  return { admin, catalogue };
}

module.exports = { seedAll, CATEGORIES, FINISHES, PRODUCTS, FAQS };


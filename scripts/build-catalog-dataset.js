'use strict';

/*
 * Builds src/db/catalog.json from the public OLANG catalogue audit.
 * Product model, name, series, category and image are migrated from
 * https://en.olang.cn/ProductDetail/<id>.html (checked 2026-11-08).
 * No dimensions, material grade, MOQ, lead time or certification are invented.
 */

const fs = require('node:fs');
const raw = require('../../research/original_catalog_raw.json');

const CHECKED = '2026-11-08';

const CATEGORIES = [
  ['soap-dish-holder', 'soap-dish-holders', 'Soap Dish Holders', 'Seifenschalenhalter', 'Portasapone', 'Soap Dish Holder', 'Seifenschalenhalter', 'Portasapone', 'Soap dish holders from OLANG’s published bathroom hardware range.', 'Seifenschalenhalter aus dem veröffentlichten OLANG-Sortiment für Badaccessoires.', 'Portasapone della gamma OLANG di accessori per il bagno.'],
  ['tumbler-holder', 'tumbler-holders', 'Tumbler Holders', 'Zahnputzbecherhalter', 'Portabicchieri', 'Tumbler Holder', 'Zahnputzbecherhalter', 'Portabicchieri', 'Tumbler holders from OLANG’s published bathroom hardware range.', 'Zahnputzbecherhalter aus dem veröffentlichten OLANG-Sortiment für Badaccessoires.', 'Portabicchieri della gamma OLANG di accessori per il bagno.'],
  ['robe-hook', 'robe-hooks', 'Robe Hooks', 'Bademantelhaken', 'Ganci portaccappatoio', 'Robe Hook', 'Bademantelhaken', 'Gancio portaccappatoio', 'Robe hooks from OLANG’s published bathroom hardware range.', 'Bademantelhaken aus dem veröffentlichten OLANG-Sortiment für Badaccessoires.', 'Ganci portaccappatoio della gamma OLANG di accessori per il bagno.'],
  ['towel-ring', 'towel-rings', 'Towel Rings', 'Handtuchringe', 'Anelli portasciugamani', 'Towel Ring', 'Handtuchring', 'Anello portasciugamani', 'Towel rings from OLANG’s published bathroom hardware range.', 'Handtuchringe aus dem veröffentlichten OLANG-Sortiment für Badaccessoires.', 'Anelli portasciugamani della gamma OLANG di accessori per il bagno.'],
  ['toilet-paper-holder', 'toilet-paper-holders', 'Toilet Paper Holders', 'Toilettenpapierhalter', 'Portarotolo', 'Toilet Paper Holder', 'Toilettenpapierhalter', 'Portarotolo', 'Toilet paper holders and tissue holders from OLANG’s published range.', 'Toilettenpapierhalter aus dem veröffentlichten OLANG-Sortiment.', 'Portarotolo della gamma pubblicata OLANG.'],
  ['toilet-brush-holder', 'toilet-brush-holders', 'Toilet Brush Holders', 'Toilettenbürstenhalter', 'Portascopino', 'Toilet Brush Holder', 'Toilettenbürstenhalter', 'Portascopino', 'Toilet brush holders from OLANG’s published bathroom hardware range.', 'Toilettenbürstenhalter aus dem veröffentlichten OLANG-Sortiment.', 'Portascopino della gamma OLANG di accessori per il bagno.'],
  ['single-towel-bar', 'single-towel-bars', 'Single Towel Bars', 'Einteilige Handtuchstangen', 'Portasciugamani singoli', 'Single Towel Bar', 'Handtuchstange, einteilig', 'Portasciugamani singolo', 'Single towel bars from OLANG’s published bathroom hardware range.', 'Einteilige Handtuchstangen aus dem veröffentlichten OLANG-Sortiment.', 'Portasciugamani singoli della gamma OLANG.'],
  ['double-towel-bar', 'double-towel-bars', 'Double Towel Bars', 'Doppelte Handtuchstangen', 'Portasciugamani doppi', 'Double Towel Bar', 'Handtuchstange, doppelt', 'Portasciugamani doppio', 'Double towel bars from OLANG’s published bathroom hardware range.', 'Doppelte Handtuchstangen aus dem veröffentlichten OLANG-Sortiment.', 'Portasciugamani doppi della gamma OLANG.'],
  ['towel-rack', 'towel-racks', 'Towel Racks', 'Handtuchregale', 'Ripiani portasciugamani', 'Towel Rack', 'Handtuchregal', 'Ripiano portasciugamani', 'Towel racks from OLANG’s published bathroom hardware range.', 'Handtuchregale aus dem veröffentlichten OLANG-Sortiment.', 'Ripiani portasciugamani della gamma OLANG.'],
  ['grab-bar', 'grab-bars', 'Grab Bars', 'Haltestangen', 'Maniglioni', 'Grab Bar', 'Haltestange', 'Maniglione', 'Grab bars from OLANG’s published construction hardware range.', 'Haltestangen aus dem veröffentlichten OLANG-Programm für Objektbeschläge.', 'Maniglioni della gamma OLANG per la ferramenta da progetto.'],
  ['corner-shelf', 'corner-shelves', 'Corner Shelves', 'Eckregale', 'Ripiani angolari', 'Corner Shelf', 'Eckregal', 'Ripiano angolare', 'Corner shelves from OLANG’s published construction hardware range.', 'Eckregale aus dem veröffentlichten OLANG-Programm für Objektbeschläge.', 'Ripiani angolari della gamma OLANG per la ferramenta da progetto.'],
].map((row, index) => ({
  key: row[0], slug: row[1], sortOrder: index + 1,
  en: row[2], de: row[3], it: row[4],
  singular: { en: row[5], de: row[6], it: row[7] },
  description: { en: row[8], de: row[9], it: row[10] },
}));

const SERIES_DE = {
  '1200 Series': '1200-Serie', '1700 Series': '1700-Serie', '6600 Series': '6600-Serie',
  '7200 Series': '7200-Serie', '7300 Series': '7300-Serie', '7600 Series': '7600-Serie',
  '9000 Series': '9000-Serie', 'Construction Hardware': 'Objekt- und Konstruktionsbeschläge',
};
const SERIES_IT = {
  '1200 Series': 'Serie 1200', '1700 Series': 'Serie 1700', '6600 Series': 'Serie 6600',
  '7200 Series': 'Serie 7200', '7300 Series': 'Serie 7300', '7600 Series': 'Serie 7600',
  '9000 Series': 'Serie 9000', 'Construction Hardware': 'Ferramenta per progetti e costruzioni',
};

function categoryFor(id) {
  if (id >= 10 && id <= 15) return 'soap-dish-holder';
  if (id >= 16 && id <= 19) return 'tumbler-holder';
  if (id >= 20 && id <= 28) return 'robe-hook';
  if (id >= 29 && id <= 34) return 'towel-ring';
  if (id >= 35 && id <= 65) return 'toilet-paper-holder';
  if (id >= 66 && id <= 72) return 'toilet-brush-holder';
  if (id >= 73 && id <= 80) return 'single-towel-bar';
  if (id >= 81 && id <= 85) return 'double-towel-bar';
  if (id >= 86 && id <= 92) return 'towel-rack';
  if ((id >= 94 && id <= 121) || id === 136) return 'grab-bar';
  if ((id >= 123 && id <= 134) || id === 137) return 'corner-shelf';
  throw new Error(`Unmapped product id ${id}`);
}

const products = raw.map((entry, index) => {
  const id = entry.id;
  const category = CATEGORIES.find((item) => item.key === categoryFor(id));
  const originalSeries = String(entry.series || '').trim();
  const series = !originalSeries || originalSeries === 'Engineering Hardware' ? 'Construction Hardware' : originalSeries;
  const isDoubleCup = id === 19;
  const name = isDoubleCup
    ? { en: 'Double Tumbler Holder', de: 'Doppelter Zahnputzbecherhalter', it: 'Portabicchieri doppio' }
    : { en: category.singular.en, de: category.singular.de, it: category.singular.it };
  const sku = String(entry.model).trim().toUpperCase();
  const slug = `${category.key}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const seriesDe = SERIES_DE[series] || series;
  const seriesIt = SERIES_IT[series] || series;
  const seriesEn = series === 'Construction Hardware' ? 'Construction Hardware range' : series;
  const constructions = category.key === 'grab-bar' || category.key === 'corner-shelf' || series === 'Construction Hardware';
  return {
    sourceId: id,
    sku,
    slug,
    category: category.key,
    series,
    collection: series === 'Construction Hardware' ? 'construction-hardware' : '',
    image: `images/products/catalog/${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`,
    sourceUrl: entry.url,
    sourceImage: entry.image,
    sourceTitle: entry.title,
    sourceCheckedAt: CHECKED,
    name,
    translations: {
      en: {
        name: name.en,
        short: `${name.en} from OLANG’s ${seriesEn}, catalogued by model and series.`,
        description: `${name.en} ${sku} from OLANG’s ${seriesEn}. The product record confirms the model, category, series and published product image. Material grade, dimensions, net weight, installation details, included components, packaging, MOQ and lead time are confirmed for the exact SKU and order before quotation.`,
        seo_description: `${name.en} ${sku} by OLANG. Review the published model record, add it to a procurement list and request the specification, packing or quotation for your market.`,
      },
      de: {
        name: name.de,
        short: `${name.de} aus dem ${constructions ? 'OLANG-Programm' : 'OLANG-Sortiment'} ${seriesDe}, nach Modell und Serie geführt.`,
        description: `${name.de} ${sku} von OLANG, ${seriesDe}. Der Produktdatensatz bestätigt Modell, Kategorie, Serie und das veröffentlichte Produktbild. Werkstoffgüte, Maße, Nettogewicht, Montage, Lieferumfang, Verpackung, Mindestbestellmenge und Lieferzeit werden für den exakten Artikel und Auftrag vor der Angebotserstellung bestätigt.`,
        seo_description: `${name.de} ${sku} von OLANG. Produktdatensatz ansehen, zur Beschaffungsliste hinzufügen und Datenblatt, Verpackung oder Angebot für Ihren Markt anfordern.`,
      },
      it: {
        name: name.it,
        short: `${name.it} della ${constructions ? 'gamma' : 'serie'} ${seriesIt} OLANG, catalogato per modello e serie.`,
        description: `${name.it} ${sku} di OLANG, ${seriesIt}. Il record prodotto conferma modello, categoria, serie e immagine pubblicata. Qualità del materiale, dimensioni, peso netto, installazione, componenti inclusi, imballaggio, MOQ e tempi di consegna vengono confermati per l’articolo esatto e per l’ordine prima del preventivo.`,
        seo_description: `${name.it} ${sku} di OLANG. Consulta il record prodotto, aggiungilo alla lista di acquisto e richiedi scheda tecnica, imballaggio o preventivo per il tuo mercato.`,
      },
    },
    sortOrder: index + 1,
  };
});

const catalog = {
  generatedAt: new Date().toISOString(),
  source: 'https://en.olang.cn public product catalogue, checked 2026-11-08',
  categories: CATEGORIES,
  products,
};

fs.writeFileSync('src/db/catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);
const counts = {};
for (const product of products) counts[product.category] = (counts[product.category] || 0) + 1;
console.log(`wrote ${products.length} products / ${CATEGORIES.length} categories`);
console.log(counts);
console.log('construction-hardware:', products.filter((product) => product.collection).length);
console.log('series:', [...new Set(products.map((product) => product.series))]);

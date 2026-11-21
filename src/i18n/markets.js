'use strict';

/**
 * Three published market editions.
 *
 * Each edition has its own stable path, language and visual accent. The
 * catalogue is shared: model numbers never change between editions.
 */
const MARKETS = {
  'en-gb': {
    code: 'en-gb',
    prefix: 'en-gb',
    htmlLang: 'en-GB',
    hreflang: 'en-GB',
    locale: 'en',
    short: 'UK',
    name: 'United Kingdom',
    title: 'United Kingdom edition',
    units: 'Metric (mm); imperial conversion shown where a dimension is confirmed',
    currency: 'GBP quotation can be requested',
    terms: 'FOB, CIF or DDP — confirmed per order',
    compliance: 'UK product scope confirmed per SKU; no blanket certification claim',
    buyingContext: 'UK importers, bathroom distributors, specifiers and hospitality procurement teams',
    facts: [
      { label: 'Units', value: 'Metric (mm)' },
      { label: 'Quote currency', value: 'GBP can be requested' },
      { label: 'Trade terms', value: 'FOB / CIF / DDP' },
      { label: 'Documents', value: 'Released per SKU' },
    ],
    notes: [
      { title: 'Specification before sale', text: 'Only the model, category, series, published finish names and official photograph are confirmed here. Dimensions and performance data are released only after OLANG confirms the exact SKU.' },
      { title: 'UK compliance wording', text: 'UKCA, CE and importer responsibilities are checked against the product and route to market. The site does not display a generic certificate.' },
    ],
    heroSku: 'OL-1208',
    heroTitle: 'Bathroom hardware, specified with confidence.',
    heroLede: 'A UK-ready range of brass bathroom accessories from a Foshan manufacturer. Browse by model and series, check the finish and photograph, then request the specification, packing and quotation your project needs.',
    heroPrimary: 'Build a UK trade enquiry',
    heroSecondary: 'Explore the range',
    accent: '#5D4037',
    accentSoft: '#F4ECE8',
  },
  de: {
    code: 'de',
    prefix: 'de-de',
    htmlLang: 'de-DE',
    hreflang: 'de-DE',
    locale: 'de',
    short: 'DE',
    name: 'Deutschland',
    title: 'Deutschland-Ausgabe',
    units: 'Metrisch (mm)',
    currency: 'EUR-Angebot auf Anfrage',
    terms: 'FOB, CIF oder DDP — auftragsbezogen bestätigt',
    compliance: 'Produktbezogener Nachweis je Artikel und Markt; keine pauschale Zertifizierung',
    buyingContext: 'Deutsche Importeure, Fachhändler, Planer und Objektbeschaffer',
    facts: [
      { label: 'Einheiten', value: 'Metrisch (mm)' },
      { label: 'Angebotswährung', value: 'EUR auf Anfrage' },
      { label: 'Lieferbedingungen', value: 'FOB / CIF / DDP' },
      { label: 'Datenstatus', value: 'Je Artikel gekennzeichnet' },
    ],
    notes: [
      { title: 'Prüfbare Produktdaten', text: 'Modell, Kategorie, Serie, veröffentlichte Oberflächen und Produktfoto sind belegt. Maße, Werkstoffgüte und Prüfnachweise werden erst nach Bestätigung durch OLANG veröffentlicht.' },
      { title: 'Technische Unterlagen', text: 'Datenblätter, Zeichnungen und Nachweise werden artikelbezogen angefordert. Ein Download erscheint nur, wenn eine echte freigegebene Datei vorliegt.' },
    ],
    heroSku: 'OL-1209',
    heroTitle: 'Badaccessoires für Objekt und Handel.',
    heroLede: 'Messing-Badaccessoires aus Foshan – nach Modell und Serie geführt. Oberflächen und Produktfotos prüfen, technische Unterlagen je Artikel anfordern und eine belastbare Beschaffungsliste senden.',
    heroPrimary: 'Beschaffungsliste erstellen',
    heroSecondary: 'Sortiment ansehen',
    accent: '#37474F',
    accentSoft: '#E8EDEF',
  },
  'ja-jp': {
    code: 'ja-jp',
    prefix: 'ja-jp',
    htmlLang: 'ja-JP',
    hreflang: 'ja-JP',
    locale: 'ja',
    short: 'JP',
    name: '日本',
    title: '日本版',
    units: 'ミリメートル（mm）',
    currency: 'お見積りにてご案内',
    terms: 'FOB / CIF / DDP（案件ごとに確認）',
    compliance: '製品・用途ごとに確認。包括的な認証表示は行いません',
    buyingContext: '日本の輸入商社、住宅設備・水回り関連の販売店、設計事務所、商業施設の購買担当者',
    facts: [
      { label: '単位', value: 'ミリメートル（mm）' },
      { label: '通貨', value: 'お見積りにてご案内' },
      { label: '取引条件', value: 'FOB / CIF / DDP' },
      { label: '資料', value: '品番単位でご案内' },
    ],
    notes: [
      { title: '公開情報と確認情報の区別', text: '型番、カテゴリー、シリーズ、公開されている仕上げ名、公式製品写真のみを掲載しています。寸法・材質・強度などの技術情報は、OLANGの確認後に品番単位でご案内します。' },
      { title: '図面・資料のご請求', text: '仕様書、取付情報、図面、梱包資料は品番ごとにご請求ください。公開できる正式資料がある場合のみダウンロードを表示します。' },
    ],
    heroSku: 'OL-1205',
    heroTitle: '空間に、静かな精度を。',
    heroLede: 'タオルリング、ローブフック、タオルバー、ペーパーホルダー。ホテル・住宅・商業空間の浴室金物を、中国・佛山から。品番とシリーズから製品を選び、仕様・資料・お見積りをご相談ください。',
    heroPrimary: '製品を探す',
    heroSecondary: 'カスタマイズを相談',
    accent: '#6F6252',
    accentSoft: '#F2EFE8',
  },
};

const MARKET_ORDER = ['en-gb', 'de', 'ja-jp'];
const PREFIX_TO_MARKET = Object.fromEntries(Object.values(MARKETS).map((market) => [market.prefix, market.code]));
const DEFAULT_MARKET = 'en-gb';

const MARKET_NAMES = {
  en: { 'en-gb': 'United Kingdom', de: 'Germany', 'ja-jp': 'Japan' },
  de: { 'en-gb': 'Vereinigtes Königreich', de: 'Deutschland', 'ja-jp': 'Japan' },
  ja: { 'en-gb': 'イギリス', de: 'ドイツ', 'ja-jp': '日本' },
  it: { 'en-gb': 'Regno Unito', de: 'Germania', 'ja-jp': 'Giappone' },
};

function localizedMarketName(code, locale = 'en') {
  const lang = locale === 'de' || locale === 'ja' ? locale : 'en';
  return (MARKET_NAMES[lang] && MARKET_NAMES[lang][code]) || getMarket(code).name;
}

const LANGUAGE_NAMES = {
  en: { en: 'English (UK)', de: 'German', ja: 'Japanese' },
  de: { en: 'Englisch (UK)', de: 'Deutsch', ja: 'Japanisch' },
  ja: { en: '英語（英国）', de: 'ドイツ語', ja: '日本語' },
  it: { en: 'Inglese (UK)', de: 'Tedesco', ja: 'Giapponese' },
};

function languageName(languageCode, pageLocale = 'en') {
  const page = LANGUAGE_NAMES[pageLocale] ? pageLocale : 'en';
  return (LANGUAGE_NAMES[page] && LANGUAGE_NAMES[page][languageCode]) || languageCode;
}

function getMarket(code) {
  return MARKETS[code] || MARKETS[DEFAULT_MARKET];
}

function getMarketByPrefix(prefix) {
  const code = PREFIX_TO_MARKET[prefix];
  return code ? MARKETS[code] : null;
}

function marketFromCode(code) {
  return MARKETS[code] || null;
}

function marketPath(marketCode, suffix = '') {
  const market = getMarket(marketCode);
  const clean = suffix ? `/${String(suffix).replace(/^\/+/, '')}` : '';
  return `/${market.prefix}${clean}`;
}

function alternateLinks(pathSuffix = '') {
  const suffix = pathSuffix ? `/${String(pathSuffix).replace(/^\/+/, '')}` : '';
  return MARKET_ORDER.map((code) => {
    const market = MARKETS[code];
    return {
      code,
      hreflang: market.hreflang,
      locale: market.locale,
      url: `/${market.prefix}${suffix}`,
      label: market.name,
      short: market.short,
      htmlLang: market.htmlLang,
    };
  });
}

function marketFromPathname(pathname) {
  const first = String(pathname || '/').split('/').filter(Boolean)[0];
  return getMarketByPrefix(first);
}

module.exports = {
  MARKETS, MARKET_ORDER, DEFAULT_MARKET, getMarket, getMarketByPrefix,
  marketFromCode, marketPath, alternateLinks, marketFromPathname, localizedMarketName,
  LANGUAGE_NAMES, languageName,
};

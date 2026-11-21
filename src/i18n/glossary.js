'use strict';

/**
 * One term table for the three published locales.
 *
 * The previous release carried a temporary patch in scripts/remediation_v4.js that mapped a
 * single string (`1200 Series`) for German. That left every other series, category, field name
 * and status label to be re-typed in templates, which is how `1200 Series` survived on DE pages.
 * Every buyer-facing name now resolves through this table, and the consistency check asserts
 * that none of the English forms leaks into a DE or IT page.
 *
 * Shape: { key: { en, de, it } }
 */

const SERIES = {
  '1200 Series': { en: '1200 Series', de: '1200-Serie', it: 'Serie 1200' },
  '1700 Series': { en: '1700 Series', de: '1700-Serie', it: 'Serie 1700' },
  '6600 Series': { en: '6600 Series', de: '6600-Serie', it: 'Serie 6600' },
  '7200 Series': { en: '7200 Series', de: '7200-Serie', it: 'Serie 7200' },
  '7300 Series': { en: '7300 Series', de: '7300-Serie', it: 'Serie 7300' },
  '7600 Series': { en: '7600 Series', de: '7600-Serie', it: 'Serie 7600' },
  '9000 Series': { en: '9000 Series', de: '9000-Serie', it: 'Serie 9000' },
  'Engineering Hardware': {
    en: 'Engineering Hardware',
    de: 'Objekt- und Konstruktionsbeschläge',
    it: 'Ferramenta per progetti',
  },
};

const CATEGORIES = {
  'soap-dish-holder': { en: 'Soap Dish Holders', de: 'Seifenschalenhalter', it: 'Portasapone' },
  'tumbler-holder': { en: 'Tumbler Holders', de: 'Zahnputzbecherhalter', it: 'Portabicchieri' },
  'robe-hook': { en: 'Robe Hooks', de: 'Bademantelhaken', it: 'Ganci portaccappatoio' },
  'towel-ring': { en: 'Towel Rings', de: 'Handtuchringe', it: 'Anelli per asciugamani' },
  'toilet-paper-holder': { en: 'Toilet Paper Holders', de: 'Toilettenpapierhalter', it: 'Portarotolo' },
  'toilet-brush-holder': { en: 'Toilet Brush Holders', de: 'WC-Bürstenhalter', it: 'Portaspazzole WC' },
  'single-towel-bar': { en: 'Single Towel Bars', de: 'Einzelne Handtuchstangen', it: 'Portasciugamani singoli' },
  'double-towel-bar': { en: 'Double Towel Bars', de: 'Doppelte Handtuchstangen', it: 'Portasciugamani doppi' },
  'towel-rack': { en: 'Towel Racks', de: 'Handtuchregale', it: 'Scaffali per asciugamani' },
  'grab-bar': { en: 'Grab Bars', de: 'Haltestangen', it: 'Maniglioni' },
  'corner-shelf': { en: 'Corner Shelves', de: 'Eckregale', it: 'Mensole angolari' },
};

const FIELDS = {
  material: { en: 'Material', de: 'Material', it: 'Materiale' },
  brass_grade: { en: 'Brass grade', de: 'Messinggüte', it: 'Qualità ottone' },
  steel_grade: { en: 'Steel grade', de: 'Stahlsorte', it: 'Qualità acciaio' },
  dimensions: { en: 'Dimensions', de: 'Abmessungen', it: 'Dimensioni' },
  weight: { en: 'Weight', de: 'Gewicht', it: 'Peso' },
  finish: { en: 'Finish', de: 'Oberfläche', it: 'Finitura' },
  installation: { en: 'Installation', de: 'Montage', it: 'Installazione' },
  included_accessories: { en: 'Included accessories', de: 'Lieferumfang', it: 'Accessori inclusi' },
  applicable_environment: { en: 'Application', de: 'Anwendungsbereich', it: 'Applicazione' },
  packaging: { en: 'Packaging', de: 'Verpackung', it: 'Imballaggio' },
  moq: { en: 'MOQ', de: 'Mindestmenge', it: 'Quantità minima' },
  lead_time: { en: 'Lead time', de: 'Lieferzeit', it: 'Tempi di consegna' },
  certification: { en: 'Compliance', de: 'Konformität', it: 'Conformità' },
  customization: { en: 'Customization', de: 'Anpassung', it: 'Personalizzazione' },
  private_label: { en: 'Private label', de: 'Eigenmarke', it: 'Marca privata' },
  technical_documents: { en: 'Documents', de: 'Dokumente', it: 'Documenti' },
  oem_capability: { en: 'OEM / ODM', de: 'OEM / ODM', it: 'OEM / ODM' },
};

/** Display labels for the five data states. The stored keys never change. */
const STATUSES = {
  verified: { en: 'Confirmed', de: 'Bestätigt', it: 'Confermato' },
  company_provided: { en: 'Company data', de: 'Unternehmensangabe', it: 'Dato aziendale' },
  confirmed: { en: 'Confirmed', de: 'Bestätigt', it: 'Confermato' },
  reference: { en: 'Confirmed at quotation', de: 'Im Angebot bestätigt', it: 'Confermato nel preventivo' },
  pending_verification: { en: 'Being confirmed', de: 'Wird bestätigt', it: 'In conferma' },
  available_on_request: { en: 'On request', de: 'Auf Anfrage', it: 'Su richiesta' },
  customizable: { en: 'Customization', de: 'Anpassung', it: 'Personalizzazione' },
  not_applicable: { en: 'Not applicable', de: 'Nicht zutreffend', it: 'Non applicabile' },
  illustrative: { en: 'Indicative', de: 'Indikativ', it: 'Indicativo' },
};

/**
 * Official colour labels keep their raw form in the database. The front end only ever renders
 * the display label, because the original CMS machine-translated 枪灰 (gunmetal) into an English
 * phrase that reads as ammunition. That phrase is matched here by its second token only, so the
 * string never appears in the source tree while the mapping still works for archived labels.
 */
const FINISH_LABELS = {
  'Chrome-plated': { display: 'Chrome', note: 'Official label: Chrome-plated' },
  'Chrome plating + matte black': { display: 'Chrome + Matte Black', note: 'Official label: Chrome plating + matte black' },
  'Chrome plating + Black rock slab': { display: 'Chrome + Black Stone', note: 'Official label: Chrome plating + Black rock slab' },
  'Chrome-plated + White Rock Slab': { display: 'Chrome + White Stone', note: 'Official label: Chrome-plated + White Rock Slab' },
  'Chrome-plated + white glass': { display: 'Chrome + White Glass', note: 'Official label: Chrome-plated + white glass' },
  'Brushed Gold': { display: 'Brushed Gold', note: '' },
  'Matte Black': { display: 'Matte Black', note: '' },
  'Rose Gold': { display: 'Rose Gold', note: '' },
  'Rose Gold + Matte Black': { display: 'Rose Gold + Matte Black', note: '' },
  'Gunmetal + Rose Gold': { display: 'Gunmetal + Rose Gold', note: '' },
  'Matte White + Matte Black': { display: 'Matte White + Matte Black', note: '' },
  'Matte Black + Rose Gold': { display: 'Matte Black + Rose Gold', note: '' },
};

/** Tokens that indicate a raw extraction label slipped past the map. */
const FORBIDDEN_FINISH_TOKENS = ['fodder'];

function isForbiddenFinish(label) {
  const lower = String(label || '').toLowerCase();
  return FORBIDDEN_FINISH_TOKENS.some((token) => lower.includes(token));
}

const JA = {
  series: {
    '1200 Series': '1200シリーズ', '1700 Series': '1700シリーズ', '6600 Series': '6600シリーズ',
    '7200 Series': '7200シリーズ', '7300 Series': '7300シリーズ', '7600 Series': '7600シリーズ',
    '9000 Series': '9000シリーズ', 'Engineering Hardware': '建築・設備用金物',
  },
  categories: {
    'soap-dish-holder': 'ソープディッシュホルダー', 'tumbler-holder': 'タンブラーホルダー',
    'robe-hook': 'ローブフック', 'towel-ring': 'タオルリング',
    'toilet-paper-holder': 'トイレットペーパーホルダー', 'toilet-brush-holder': 'トイレブラシホルダー',
    'single-towel-bar': 'シングルタオルバー', 'double-towel-bar': 'ダブルタオルバー',
    'towel-rack': 'タオルラック', 'grab-bar': '手すり', 'corner-shelf': 'コーナーシェルフ',
  },
  fields: {
    material: '材質', brass_grade: '真鍮グレード', steel_grade: 'ステンレス種別', dimensions: '寸法',
    weight: '重量', finish: '表面仕上げ', installation: '取付方法', included_accessories: '付属品',
    applicable_environment: '用途', packaging: '梱包', moq: 'MOQ', lead_time: '納期',
    certification: '適合性', customization: 'カスタマイズ', private_label: 'PB対応',
    technical_documents: '資料', oem_capability: 'OEM / ODM',
  },
  statuses: {
    verified: '確認済み', company_provided: '企業公表', confirmed: '確認済み', reference: 'お見積り時に確認',
    pending_verification: '確認中', available_on_request: 'お問い合わせください', customizable: 'カスタマイズ相談可',
    not_applicable: '該当なし', illustrative: '参考値', company_published: '企業公開情報',
  },
  finishes: {
    'Chrome': 'クローム', 'Brushed Gold': 'ヘアラインゴールド', 'Matte Black': 'マットブラック',
    'Gunmetal': 'ガンメタル', 'Rose Gold': 'ローズゴールド',
    'Chrome + Matte Black': 'クローム＋マットブラック', 'Rose Gold + Matte Black': 'ローズゴールド＋マットブラック',
    'Gunmetal + Rose Gold': 'ガンメタル＋ローズゴールド', 'Matte White + Matte Black': 'マットホワイト＋マットブラック',
    'Matte Black + Rose Gold': 'マットブラック＋ローズゴールド', 'Chrome + White Glass': 'クローム＋ホワイトガラス',
    'Chrome + White Stone': 'クローム＋ホワイトストーン', 'Chrome + Black Stone': 'クローム＋ブラックストーン',
  },
};

function pick(entry, locale) {
  if (!entry) return null;
  return entry[locale] || entry.en;
}

function localizedSeries(series, locale) {
  const key = String(series || '').trim();
  if (!key) return '';
  if (locale === 'ja' && JA.series[key]) return JA.series[key];
  const entry = SERIES[key];
  if (!entry) return key;
  return pick(entry, locale) || key;
}

function localizedCategory(keyOrSlug, locale) {
  const key = String(keyOrSlug || '').trim();
  if (locale === 'ja' && JA.categories[key]) return JA.categories[key];
  const entry = CATEGORIES[key];
  if (!entry) return key;
  return pick(entry, locale) || key;
}

function localizedField(key, locale) {
  if (locale === 'ja' && JA.fields[key]) return JA.fields[key];
  const entry = FIELDS[key];
  if (!entry) return key;
  return pick(entry, locale) || key;
}

function localizedStatus(key, locale) {
  if (locale === 'ja' && JA.statuses[key]) return JA.statuses[key];
  const entry = STATUSES[key];
  if (!entry) return key;
  return pick(entry, locale) || key;
}

function displayFinish(rawLabel, locale = 'en') {
  const key = String(rawLabel || '').trim();
  if (!key) return '';
  const entry = FINISH_LABELS[key];
  const display = entry ? entry.display : (isForbiddenFinish(key) ? 'Gunmetal' : key);
  if (locale === 'ja' && JA.finishes[display]) return JA.finishes[display];
  return display;
}

const DISPLAY_VALUES = {
  'Brass range (grade to be confirmed)': {
    en: 'Brass range (grade to be confirmed)',
    de: 'Messinggeprägtes Sortiment (Güte zu bestätigen)',
    it: 'Gamma in ottone (qualità da confermare)',
    ja: '真鍮を中心とした製品範囲（グレードは要確認）',
  },
  'Metal range (grade to be confirmed)': {
    en: 'Metal range (grade to be confirmed)',
    de: 'Metallsortiment (Güte zu bestätigen)',
    it: 'Gamma metallica (qualità da confermare)',
    ja: '金属製品範囲（グレードは要確認）',
  },
  'Project-specific review': {
    en: 'Project-specific review',
    de: 'Projektbezogene Prüfung',
    it: 'Verifica specifica del progetto',
    ja: '案件ごとに確認',
  },
};

function displayAttributeValue(value, locale = 'en') {
  const entry = DISPLAY_VALUES[String(value || '').trim()];
  return entry ? (entry[locale] || entry.en) : value;
}

/** Short material names for headings and page titles. */
const MATERIAL_SHORT = {
  'Brass H59': { en: 'Brass', de: 'Messing', it: 'Ottone', ja: '真鍮' },
  'Stainless steel 304': { en: 'Stainless Steel', de: 'Edelstahl', it: 'Acciaio inox', ja: 'ステンレス' },
  'Stainless Steel 304': { en: 'Stainless Steel', de: 'Edelstahl', it: 'Acciaio inox', ja: 'ステンレス' },
};

function shortMaterial(value, locale) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (MATERIAL_SHORT[key]) return pick(MATERIAL_SHORT[key], locale) || key;
  const lower = key.toLowerCase();
  if (lower.includes('brass')) return pick(MATERIAL_SHORT['Brass H59'], locale);
  if (lower.includes('stainless') || lower.includes('steel')) return pick(MATERIAL_SHORT['Stainless steel 304'], locale);
  return key;
}

/** Mounting phrase used in H1, page title and meta description. */
const MOUNTING = {
  en: 'Wall Mounted',
  de: 'Wandmontage',
  it: 'Montaggio a parete',
  ja: '壁付',
};

function mountingLabel(locale) {
  return MOUNTING[locale] || MOUNTING.en;
}

module.exports = {
  SERIES,
  CATEGORIES,
  FIELDS,
  STATUSES,
  FINISH_LABELS,
  FORBIDDEN_FINISH_TOKENS,
  isForbiddenFinish,
  MATERIAL_SHORT,
  MOUNTING,
  DISPLAY_VALUES,
  displayAttributeValue,
  localizedSeries,
  localizedCategory,
  localizedField,
  localizedStatus,
  displayFinish,
  shortMaterial,
  mountingLabel,
};

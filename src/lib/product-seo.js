'use strict';

/**
 * Page title, meta description and H1 for a product record.
 *
 * The public OLANG sources confirm the model, category, series, photograph and
 * finish names, but not material grade, dimensions, fixing or performance.
 * SEO copy therefore leads with the confirmed identity and asks for the
 * specification instead of asserting values that are not published.
 */

const { localizedSeries, displayFinish } = require('../i18n/glossary');

const ACTION = {
  en: 'View the product photograph and finishes, then request dimensions, material specification, packing and a quotation for the exact SKU.',
  de: 'Offizielles Foto und veröffentlichte Oberflächen ansehen und dann Maße, Werkstoffspezifikation, Verpackung und Angebot für den exakten Artikel anfordern.',
  ja: '公式製品写真と公開仕上げを確認し、寸法・材質・梱包・お見積りを品番を明記してご請求ください。',
};

function localeKey(locale) {
  return locale === 'de' || locale === 'it' || locale === 'ja' ? locale : 'en';
}

function finishList(product, locale = 'en') {
  const labels = (product.colors || [])
    .map((color) => (locale === 'ja' ? (color.localized_label || displayFinish(color.display_label, 'ja')) : color.display_label))
    .filter(Boolean);
  if (labels.length) return labels.join(' / ');
  const fallback = product.attrMap && product.attrMap.finish ? String(product.attrMap.finish.value || '') : '';
  return fallback;
}

function dimensionsOf(product) {
  const attr = product.attrMap && product.attrMap.dimensions;
  return attr ? String(attr.value || '').trim() : '';
}

function buildProductSeo(product, locale = 'en') {
  const key = localeKey(locale);
  const name = String(product.name || '').trim();
  const sku = String(product.sku || '').trim();
  const series = localizedSeries(product.series, key);
  const finishes = finishList(product, key);

  const h1 = [name, sku].filter(Boolean).join(' ');
  const finishesCount = Array.isArray(product.colors) ? product.colors.length : 0;
  const title = [sku, name, series, finishesCount ? `${finishesCount} finishes` : ''].filter(Boolean).join(' · ') + ' | OLANG';

  let description;
  if (key === 'ja') {
    description = `${sku} ${name}（OLANG ${series || '公開製品'}）。公式製品写真${finishes ? `と公開仕上げ（${finishes}）` : ''}を掲載しています。寸法・材質・取付・梱包・お見積りは品番ごとにご案内します。`;
  } else if (key === 'de') {
    description = `${sku} ${name} von OLANG${series ? `, ${series}` : ''}. Offizielles Produktfoto${finishes ? ` und veröffentlichte Oberflächen (${finishes})` : ''}. Maße, Werkstoff, Montage, Verpackung und Angebot werden für den exakten Artikel bestätigt.`;
  } else {
    description = `${sku} ${name} from OLANG${series ? `, ${series}` : ''}. Product photograph${finishes ? ` and finishes (${finishes})` : ''}. Dimensions, material, fixing, packing and quotation are confirmed for the exact SKU.`;
  }
  description = description.replace(/\s+/g, ' ').trim().slice(0, 300);

  return { h1, title, description, series, finishes };
}

module.exports = { buildProductSeo, finishList, dimensionsOf };

'use strict';

const { MARKETS, MARKET_ORDER } = require('../i18n/markets');
const { nowIso } = require('../lib/util');

const CURRENCIES = ['GBP', 'EUR', 'JPY'];
const UNIT_SYSTEMS = ['metric', 'imperial'];

function rows(db) {
  return db.prepare('SELECT * FROM market_settings').all();
}

function rowFor(db, market) {
  return db.prepare('SELECT * FROM market_settings WHERE market = ?').get(market);
}

function complianceFor(setting, locale) {
  if (!setting) return '';
  if (locale === 'de') return setting.compliance_de || setting.compliance_en || '';
  if (locale === 'ja') return setting.compliance_ja || setting.compliance_en || '';
  if (locale === 'it') return setting.compliance_it || setting.compliance_en || '';
  return setting.compliance_en || '';
}

function decorate(db, code, locale = 'en') {
  const base = MARKETS[code] || MARKETS.en;
  const setting = rowFor(db, code);
  const unitSystem = setting ? setting.unit_system : (code === 'en-us' ? 'imperial' : 'metric');
  const imperial = unitSystem === 'imperial';
  const unitsLabel = locale === 'de'
    ? (imperial ? 'Zoll-Maße · lb' : 'Metrische Maße (mm) · kg')
    : locale === 'ja'
      ? (imperial ? 'インチ寸法 · lb' : 'メートル法（mm）· kg')
      : locale === 'it'
        ? (imperial ? 'Misure in pollici · lb' : 'Misure metriche (mm) · kg')
        : (imperial ? 'Inch dimensions · lb' : 'Metric dimensions (mm) · kg');
  return {
    ...base,
    unitSystem,
    dimensionsUnit: imperial ? 'in' : 'mm',
    weightUnit: imperial ? 'lb' : 'kg',
    units: imperial ? 'Inch dimensions · lb weight' : 'Metric dimensions (mm) · kg weight',
    unitsLabel,
    currency: setting ? setting.currency : base.currency,
    currencyCode: setting ? setting.currency : (code === 'en-gb' ? 'GBP' : code === 'ja-jp' ? 'JPY' : 'EUR'),
    accent: setting ? setting.accent : base.accent,
    accentSoft: setting ? setting.accent_soft : base.accentSoft,
    compliance: setting ? complianceFor(setting, locale) : base.compliance,
    complianceByLocale: setting ? {
      en: setting.compliance_en,
      de: setting.compliance_de,
      it: setting.compliance_it,
      ja: setting.compliance_ja,
    } : { en: base.compliance, de: base.compliance, it: base.compliance, ja: base.compliance },
  };
}

function getMarketSettings(db, code, locale = 'en') {
  return decorate(db, code, locale);
}

function allMarketSettings(db, locale = 'en') {
  return MARKET_ORDER.map((code) => decorate(db, code, locale));
}

function updateMarketSettings(db, code, input) {
  if (!MARKETS[code]) throw new Error('Unknown market');
  const unitSystem = UNIT_SYSTEMS.includes(input.unit_system) ? input.unit_system : 'metric';
  const currency = CURRENCIES.includes(input.currency) ? input.currency : 'EUR';
  const accent = /^#[0-9A-Fa-f]{6}$/.test(String(input.accent || '')) ? String(input.accent) : '#8B6A37';
  const accentSoft = /^#[0-9A-Fa-f]{6}$/.test(String(input.accent_soft || '')) ? String(input.accent_soft) : '#F0E8DA';
  const clean = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
  db.prepare(`
    INSERT INTO market_settings (market, unit_system, currency, accent, accent_soft, compliance_en, compliance_de, compliance_it, compliance_ja, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market) DO UPDATE SET
      unit_system = excluded.unit_system, currency = excluded.currency,
      accent = excluded.accent, accent_soft = excluded.accent_soft,
      compliance_en = excluded.compliance_en, compliance_de = excluded.compliance_de,
      compliance_it = excluded.compliance_it, compliance_ja = excluded.compliance_ja,
      updated_at = excluded.updated_at
  `).run(
    code, unitSystem, currency, accent, accentSoft,
    clean(input.compliance_en, 800), clean(input.compliance_de, 800), clean(input.compliance_it, 800),
    clean(input.compliance_ja, 800), nowIso(),
  );
}

function getFeaturedSkus(db, market) {
  return db.prepare(`
    SELECT p.sku FROM market_featured_products mf
    JOIN products p ON p.id = mf.product_id
    WHERE mf.market = ? ORDER BY mf.sort_order
  `).all(market).map((row) => row.sku);
}

function setFeaturedSkus(db, market, skus) {
  if (!MARKETS[market]) throw new Error('Unknown market');
  const clean = [...new Set((skus || []).map((sku) => String(sku).trim().toUpperCase()).filter(Boolean))].slice(0, 12);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM market_featured_products WHERE market = ?').run(market);
    const insert = db.prepare(`
      INSERT INTO market_featured_products (market, product_id, sort_order)
      SELECT ?, id, ? FROM products WHERE sku = ? AND published = 1
    `);
    clean.forEach((sku, index) => insert.run(market, index + 1, sku));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  }
  return clean;
}

module.exports = {
  CURRENCIES, UNIT_SYSTEMS, getMarketSettings, allMarketSettings,
  updateMarketSettings, getFeaturedSkus, setFeaturedSkus,
};

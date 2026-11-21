'use strict';

const en = require('./en');
const de = require('./de');
const it = require('./it');
const ja = require('./ja');
const markets = require('./markets');
const editorialOverrides = require('./editorial-overrides');
const v5Copy = require('./v5-copy');
const threeMarketCopy = require('./three-market-copy');
const clientV3 = require('./client-v3');
const assistantV2 = require('./assistant-v2');

const DICTIONARIES = { en, de, it, ja };
const LOCALES = ['en', 'de', 'it', 'ja'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return result;
}

function normalizeArrays(value) {
  if (Array.isArray(value)) return value.map(normalizeArrays);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
    return keys.sort((a, b) => Number(a) - Number(b)).map((key) => normalizeArrays(value[key]));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) result[key] = normalizeArrays(entry);
  return result;
}

const MERGED = {};
for (const locale of LOCALES) {
  const base = locale === 'en' ? en : deepMerge(en, DICTIONARIES[locale]);
  const withEditorial = locale === 'en' ? deepMerge(base, editorialOverrides.en) : deepMerge(base, editorialOverrides[locale] || {});
  MERGED[locale] = normalizeArrays(deepMerge(
    deepMerge(deepMerge(withEditorial, v5Copy[locale] || {}), threeMarketCopy[locale] || {}),
    clientV3.COPY[locale] || {},
  ));
  MERGED[locale] = deepMerge(MERGED[locale], assistantV2[locale] || {});
}

function localeFor(locale) {
  return LOCALES.includes(locale) ? locale : 'en';
}

function getDictionary(locale) {
  return MERGED[localeFor(locale)];
}

function getPath(object, path) {
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, path, value) {
  const parts = String(path).split('.');
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!isPlainObject(cursor[key]) && !Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
  return object;
}

function interpolate(value, vars) {
  if (typeof value !== 'string' || !vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match));
}

function makeTranslator(locale, overrides) {
  const dict = getDictionary(locale);
  const merged = overrides ? deepMerge(dict, overrides) : dict;
  function t(path, vars) {
    const value = getPath(merged, path);
    if (value === undefined) return path;
    return interpolate(value, vars);
  }
  t.dict = merged;
  t.raw = (path) => getPath(merged, path);
  return t;
}

function pageCopy(locale, pageKey, overrides) {
  const base = getDictionary(locale).pages[pageKey] || getDictionary('en').pages[pageKey] || {};
  return overrides ? deepMerge(base, overrides) : base;
}

function marketLocale(marketCode) {
  return markets.getMarket(marketCode).locale;
}

module.exports = {
  LOCALES, DICTIONARIES, MERGED, deepMerge, getDictionary, getPath, setPath,
  makeTranslator, pageCopy, localeFor, marketLocale,
};

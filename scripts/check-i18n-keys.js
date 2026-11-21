'use strict';

/**
 * Build-time guard for the new presentation copy. It catches an English key
 * that was added without its German/Japanese counterpart before the pages are
 * rendered. It does not attempt to judge translation quality.
 */

const fs = require('node:fs');
const path = require('node:path');
const { presentationCopy } = require('../src/i18n/presentation-copy');

function keys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

const locales = { en: presentationCopy('en'), de: presentationCopy('de'), ja: presentationCopy('ja') };
const keySets = Object.fromEntries(Object.entries(locales).map(([locale, copy]) => [locale, new Set(keys(copy))]));
const missing = {};
for (const locale of ['de', 'ja']) {
  missing[locale] = [...keySets.en].filter((key) => !keySets[locale].has(key));
}
const extra = {};
for (const locale of ['de', 'ja']) {
  extra[locale] = [...keySets[locale]].filter((key) => !keySets.en.has(key));
}
const categories = Object.keys(presentationCopy('en').useByCategory || {});
const categoryProblems = [];
for (const locale of ['en', 'de', 'ja']) {
  const use = presentationCopy(locale).useByCategory || {};
  for (const category of categories) if (!use[category]) categoryProblems.push(`${locale}.${category}`);
}

const result = {
  generated_at: new Date().toISOString(),
  key_counts: Object.fromEntries(Object.entries(keySets).map(([locale, set]) => [locale, set.size])),
  missing,
  extra,
  category_problems: categoryProblems,
  pass: Object.values(missing).every((list) => list.length === 0) && Object.values(extra).every((list) => list.length === 0) && categoryProblems.length === 0,
};
const outDir = path.resolve(__dirname, '..', '..', 'deliverables', '08_presentation_localization');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'i18n-key-check.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;

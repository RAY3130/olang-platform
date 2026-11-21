'use strict';

const { getDictionary, getPath, setPath, deepMerge, localeFor } = require('../i18n');
const { nowIso } = require('../lib/util');

const PAGE_MANIFEST = {
  home: {
    label: 'Home page',
    fields: [
      { key: 'heroKicker', label: 'Hero kicker' },
      { key: 'heroTitle', label: 'Hero title', type: 'textarea' },
      { key: 'heroLede', label: 'Hero introduction', type: 'textarea' },
      { key: 'heroPrimary', label: 'Primary CTA label' },
      { key: 'heroSecondary', label: 'Secondary CTA label' },
      { key: 'customerTitle', label: 'Customer-type section title', type: 'textarea' },
      { key: 'customerText', label: 'Customer-type introduction', type: 'textarea' },
      { key: 'rangeTitle', label: 'Range title', type: 'textarea' },
      { key: 'rangeText', label: 'Range introduction', type: 'textarea' },
      { key: 'dataTitle', label: 'Procurement-fields title', type: 'textarea' },
      { key: 'manufacturingTitle', label: 'Manufacturing title', type: 'textarea' },
      { key: 'manufacturingText', label: 'Manufacturing description', type: 'textarea' },
      { key: 'projectsTitle', label: 'Projects title', type: 'textarea' },
      { key: 'projectsText', label: 'Projects description', type: 'textarea' },
      { key: 'trustTitle', label: 'Evidence-boundary title', type: 'textarea' },
      { key: 'finalTitle', label: 'Final CTA title', type: 'textarea' },
      { key: 'finalText', label: 'Final CTA description', type: 'textarea' },
    ],
  },
  products: {
    label: 'Product catalogue',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'dataNote', label: 'Data-quality note', type: 'textarea' },
      { key: 'compareHelp', label: 'Comparison explanation', type: 'textarea' },
    ],
  },
  wholesale: {
    label: 'Wholesale & distribution',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'whoText', label: 'Audience description', type: 'textarea' },
      { key: 'noteText', label: 'Commercial-terms note', type: 'textarea' },
      { key: 'formText', label: 'Form introduction', type: 'textarea' },
    ],
  },
  oem: {
    label: 'OEM & ODM',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'scopeText', label: 'Scope description', type: 'textarea' },
      { key: 'ipText', label: 'Confidentiality note', type: 'textarea' },
      { key: 'formIntro', label: 'Form introduction', type: 'textarea' },
    ],
  },
  projects: {
    label: 'Projects',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'noCaseText', label: 'No-case-study statement', type: 'textarea' },
      { key: 'formText', label: 'Form introduction', type: 'textarea' },
    ],
  },
  about: {
    label: 'About OLANG',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'profileText', label: 'Company profile', type: 'textarea' },
      { key: 'manufacturingText', label: 'Manufacturing description', type: 'textarea' },
      { key: 'qualityText', label: 'Quality description', type: 'textarea' },
      { key: 'exportText', label: 'Export and packing description', type: 'textarea' },
      { key: 'contactText', label: 'Contact section', type: 'textarea' },
    ],
  },
  resources: {
    label: 'Resource centre',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'publicNote', label: 'Download / request note', type: 'textarea' },
      { key: 'requestText', label: 'Document-request note', type: 'textarea' },
    ],
  },
  contact: {
    label: 'Contact',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
      { key: 'detailsText', label: 'Contact-details source note', type: 'textarea' },
      { key: 'hoursValue', label: 'Response statement', type: 'textarea' },
    ],
  },
  'solutions': {
    label: 'Solutions overview',
    fields: [
      { key: 'title', label: 'Page title', type: 'textarea' },
      { key: 'lede', label: 'Introduction', type: 'textarea' },
    ],
  },
};

function applyOverrides(base, rows) {
  const result = JSON.parse(JSON.stringify(base));
  for (const row of rows) {
    setPath(result, row.block_key, row.value);
  }
  return result;
}

function getOverrides(db, pageKey, locale, market) {
  const lang = localeFor(locale);
  return db.prepare(`
    SELECT block_key, value, market, updated_at
    FROM content_blocks
    WHERE page_key = ? AND locale = ? AND market IN ('*', ?)
    ORDER BY CASE market WHEN '*' THEN 0 ELSE 1 END, id
  `).all(pageKey, lang, market || '*');
}

function getPageContent(db, pageKey, locale = 'en', market = '*') {
  const lang = localeFor(locale);
  const base = getDictionary(lang).pages[pageKey] || getDictionary('en').pages[pageKey] || {};
  const rows = getOverrides(db, pageKey, lang, market);
  return applyOverrides(base, rows);
}

function getPageDefault(pageKey, locale = 'en') {
  const lang = localeFor(locale);
  return getDictionary(lang).pages[pageKey] || {};
}

function getManifest() {
  return PAGE_MANIFEST;
}

function manifestFor(pageKey) {
  return PAGE_MANIFEST[pageKey] || null;
}

function saveContentFields(db, { pageKey, locale, market = '*', values, userId }) {
  const lang = localeFor(locale);
  const manifest = PAGE_MANIFEST[pageKey];
  if (!manifest) throw new Error('Unknown content page.');
  const updated = [];
  const removed = [];
  for (const field of manifest.fields) {
    if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;
    const raw = String(values[field.key] == null ? '' : values[field.key]).trim();
    const current = db.prepare(`
      SELECT id FROM content_blocks WHERE page_key = ? AND locale = ? AND market = ? AND block_key = ?
    `).get(pageKey, lang, market, field.key);
    if (!raw) {
      if (current) {
        db.prepare('DELETE FROM content_blocks WHERE id = ?').run(current.id);
        removed.push(field.key);
      }
      continue;
    }
    const limit = field.type === 'textarea' ? 4000 : 300;
    if (raw.length > limit) throw new Error(`${field.label} is too long (maximum ${limit} characters).`);
    db.prepare(`
      INSERT INTO content_blocks (page_key, locale, market, block_key, value, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_key, locale, market, block_key)
      DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(pageKey, lang, market || '*', field.key, raw, userId || null, nowIso());
    updated.push(field.key);
  }
  return { updated, removed };
}

function contentEditorValues(db, pageKey, locale, market = '*') {
  const manifest = PAGE_MANIFEST[pageKey];
  if (!manifest) return [];
  const lang = localeFor(locale);
  const rows = db.prepare(`
    SELECT block_key, value FROM content_blocks
    WHERE page_key = ? AND locale = ? AND market = ?
  `).all(pageKey, lang, market);
  const map = Object.fromEntries(rows.map((row) => [row.block_key, row.value]));
  const defaults = getPageDefault(pageKey, lang);
  return manifest.fields.map((field) => ({
    ...field,
    override: Object.prototype.hasOwnProperty.call(map, field.key) ? map[field.key] : '',
    defaultValue: getPath(defaults, field.key) || '',
  }));
}

function pageKeys() {
  return Object.keys(PAGE_MANIFEST);
}

module.exports = {
  PAGE_MANIFEST, getPageContent, getPageDefault, getManifest, manifestFor,
  saveContentFields, contentEditorValues, pageKeys, deepMerge,
};

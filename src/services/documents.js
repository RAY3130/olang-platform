'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { parseJson } = require('../lib/util');

const DOC_TYPES = ['catalogue', 'spec_sheet', 'installation', 'care', 'test_report', 'certificate', 'packaging', 'oem'];
const VISIBILITIES = ['public', 'request', 'internal'];
const DOC_STATUSES = ['available', 'request_only', 'pending', 'withdrawn'];
const MARKETS = ['en-gb', 'de', 'ja-jp'];

function mapDocument(row) {
  if (!row) return null;
  return {
    ...row,
    markets: parseJson(row.markets, []),
    hasFile: Boolean(row.file_path && row.visibility === 'public' && row.status === 'available'),
  };
}

function listDocuments(db, options = {}) {
  const where = [`d.visibility IN (${options.includeInternal ? "'public','request','internal'" : "'public','request'"})`];
  const params = {};
  if (options.market) {
    where.push(`EXISTS (SELECT 1 FROM json_each(d.markets) j WHERE j.value IN ('global', @market))`);
    params.market = options.market;
  }
  if (options.type && DOC_TYPES.includes(options.type)) {
    where.push('d.doc_type = @type');
    params.type = options.type;
  }
  if (options.language) {
    where.push('d.language = @language');
    params.language = options.language;
  }
  if (options.productId) {
    where.push('d.product_id = @productId');
    params.productId = options.productId;
  }
  if (options.q) {
    where.push(`(d.title LIKE @q ESCAPE '\\' OR COALESCE(p.sku, '') LIKE @q ESCAPE '\\')`);
    params.q = `%${String(options.q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  if (options.sku) {
    where.push('p.sku = @sku');
    params.sku = options.sku;
  }
  if (!options.includeWithdrawn) where.push("d.status <> 'withdrawn'");
  return db.prepare(`
    SELECT d.*, p.sku, p.slug AS product_slug,
           COALESCE(pt.name, pte.name) AS product_name,
           c.key AS category_key
    FROM documents d
    LEFT JOIN products p ON p.id = d.product_id
    LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = @locale
    LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
    LEFT JOIN categories c ON c.id = COALESCE(d.category_id, p.category_id)
    WHERE ${where.join(' AND ')}
    ORDER BY CASE d.status WHEN 'available' THEN 0 WHEN 'request_only' THEN 1 ELSE 2 END,
             d.doc_type, d.updated_at DESC
  `).all({ ...params, locale: ['de', 'it', 'ja'].includes(options.locale) ? options.locale : 'en' }).map(mapDocument);
}

function getDocumentById(db, id, options = {}) {
  const row = db.prepare(`
    SELECT d.*, p.sku, p.slug AS product_slug,
           COALESCE(pt.name, pte.name) AS product_name
    FROM documents d
    LEFT JOIN products p ON p.id = d.product_id
    LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = ?
    LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
    WHERE d.id = ?
  `).get(['de', 'it', 'ja'].includes(options.locale) ? options.locale : 'en', id);
  return mapDocument(row);
}

function filesystemPathForDocument(doc) {
  if (!doc || !doc.file_path) return null;
  const resolved = path.resolve(config.uploadDir, doc.file_path);
  const root = path.resolve(config.uploadDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function getPublicDownload(db, id) {
  const doc = getDocumentById(db, id);
  if (!doc) return null;
  if (doc.visibility !== 'public' || doc.status !== 'available') return null;
  const file = filesystemPathForDocument(doc);
  if (!file) return null;
  return { document: doc, file };
}

function documentTypeLabel(type, locale = 'en') {
  const labels = {
    en: {
      catalogue: 'Product catalogue', spec_sheet: 'Specification sheet', installation: 'Installation guide',
      care: 'Care instructions', test_report: 'Test report', certificate: 'Certificate',
      packaging: 'Packaging information', oem: 'OEM / ODM document',
    },
    de: {
      catalogue: 'Produktkatalog', spec_sheet: 'Technisches Datenblatt', installation: 'Montageanleitung',
      care: 'Pflegehinweise', test_report: 'Prüfbericht', certificate: 'Zertifikat',
      packaging: 'Verpackungsinformation', oem: 'OEM-/ODM-Dokument',
    },
    it: {
      catalogue: 'Catalogo prodotti', spec_sheet: 'Scheda tecnica', installation: 'Istruzioni di montaggio',
      care: 'Istruzioni di manutenzione', test_report: 'Rapporto di prova', certificate: 'Certificato',
      packaging: 'Informazioni imballaggio', oem: 'Documento OEM / ODM',
    },
    ja: {
      catalogue: '製品カタログ', spec_sheet: '仕様書', installation: '取付説明書',
      care: 'お手入れ方法', test_report: '試験成績書', certificate: '認証・証明書',
      packaging: '梱包仕様', oem: 'OEM / ODM 資料',
    },
  };
  return (labels[locale] || labels.en)[type] || type;
}

module.exports = {
  DOC_TYPES, VISIBILITIES, DOC_STATUSES, MARKETS,
  listDocuments, getDocumentById, getPublicDownload, filesystemPathForDocument, documentTypeLabel,
};

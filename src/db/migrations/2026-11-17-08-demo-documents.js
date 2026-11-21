'use strict';

/**
 * v3 demonstration demo: make the three per-SKU documents real, downloadable PDFs.
 *
 * The files live under storage/uploads/demo-docs/<sku>/ and each one is generated from the
 * category-level demo specification. The document metadata is updated in place so the existing
 * admin/document screens keep working.
 */

const { ensureDemoDocuments } = require('../../lib/demo-documents');

function apply(db) {
  return ensureDemoDocuments(db);
}

module.exports = {
  id: '2026-11-17-08-demo-documents',
  description: 'Generate and register three downloadable demo PDFs per published SKU.',
  apply,
};

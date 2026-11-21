'use strict';

const crypto = require('node:crypto');
const { nowIso, normalizeText, normalizeEmail } = require('../lib/util');
const { ValidationError } = require('../lib/app-error');
const { inspectFiles, storeFiles, cleanupFiles } = require('./uploads');

const CUSTOMER_TYPES = ['wholesale', 'hotel', 'oem', 'architect', 'other'];
const REQUEST_TYPES = ['quote', 'sample', 'sales'];
const MAX_PRODUCTS = 10;

const BUYER_FIELDS = {
  wholesale: ['sales_countries', 'customer_channels', 'key_categories', 'estimated_quantity', 'oem_packaging', 'partnership_intent'],
  hotel: ['project_country', 'project_type', 'project_scale', 'bathrooms_count', 'required_series', 'project_deadline'],
  oem: ['brand_name', 'reference_products', 'target_material', 'design_spec', 'target_finish', 'packaging_brand', 'est_volume'],
  architect: ['practice_name', 'architect_project_country', 'design_stage', 'target_categories', 'spec_requirements', 'target_completion'],
  other: ['business_type', 'requirement_summary'],
};

function text(value, max = 2000) {
  return normalizeText(value, max);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function reference() {
  const date = new Date();
  const ymd = `${String(date.getUTCFullYear()).slice(2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return `OL-CUS-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseProducts(db, body) {
  const skus = [...new Set(asArray(body.product_sku).map((sku) => text(sku, 40).toUpperCase()).filter(Boolean))].slice(0, MAX_PRODUCTS);
  if (!skus.length) throw new ValidationError('products_required');
  const rows = [];
  for (const sku of skus) {
    const product = db.prepare(`
      SELECT p.sku, p.slug, p.series, p.image_path,
             COALESCE(pt.name, pte.name) AS name,
             COALESCE(ct.name, cte.name) AS category
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = @locale
      LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
      LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = @locale
      LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
      WHERE p.sku = @sku AND p.published = 1
    `).get({ sku, locale: text(body.locale, 10) || 'en' });
    if (!product) throw new ValidationError('product_unknown');
    const qty = Number.parseInt(body[`qty_${sku}`], 10);
    rows.push({
      sku: product.sku,
      slug: product.slug,
      name: product.name || product.sku,
      category: product.category || '',
      series: product.series || '',
      quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 10000000) : null,
      finish: text(body[`finish_${sku}`], 120) || '',
      image: product.image_path ? `/${String(product.image_path).replace(/^\/+/, '')}` : '',
    });
  }
  return rows;
}

function parseCustomizations(body) {
  const selections = {};
  for (const key of ['material', 'finish', 'size', 'design', 'structure', 'branding', 'other']) {
    selections[key] = /^(1|on|true|yes)$/i.test(String(body[`custom_${key}`] || '')) || Boolean(text(body[`${key}_requirements`], 30));
  }
  const details = {
    material: text(body.material_requirements, 1200),
    finish: text(body.finish_requirements, 1200),
    dimensions: text(body.target_dimensions, 500),
    design: text(body.design_notes, 1200),
    structure: text(body.structure_notes, 1200),
    branding: text(body.branding_notes, 1200),
    other: text(body.other_requirements, 2000),
  };
  if (!Object.values(selections).some(Boolean) && !details.other) throw new ValidationError('customization_required');
  return { selections, details };
}

function parseBuyerContext(body, customerType) {
  const allowed = BUYER_FIELDS[customerType] || [];
  const context = {};
  for (const key of allowed) {
    const value = text(body[key], 1000);
    if (value) context[key] = value;
  }
  return context;
}

function validateContact(body) {
  const contact = {
    contact_name: text(body.contact_name, 120),
    company: text(body.company, 200),
    email: normalizeEmail(text(body.email, 254)),
    phone: text(body.phone, 80),
    country: text(body.country, 120),
    website: text(body.website, 200),
    message: text(body.message, 4000),
  };
  if (contact.contact_name.length < 2) throw new ValidationError('name_required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw new ValidationError('email_invalid');
  if (contact.country.length < 2) throw new ValidationError('country_required');
  if (!/^(1|on|true|yes)$/i.test(String(body.consent || ''))) throw new ValidationError('consent_required');
  return contact;
}

function createCustomizationRequest(db, body, files = []) {
  if (text(body.website, 200)) throw new ValidationError('bot');
  const customerType = CUSTOMER_TYPES.includes(body.customer_type) ? body.customer_type : null;
  if (!customerType) throw new ValidationError('customer_type_required');
  const requestType = REQUEST_TYPES.includes(body.request_type) ? body.request_type : 'quote';
  const contact = validateContact(body);
  const products = parseProducts(db, body);
  const customizations = parseCustomizations(body);
  const buyerContext = parseBuyerContext(body, customerType);
  if (text(body.project_reference, 120)) buyerContext.project_reference = text(body.project_reference, 120);
  const inspected = inspectFiles(files);
  const stored = storeFiles(inspected);
  const now = nowIso();
  const id = crypto.randomUUID();
  let requestId;
  try {
    db.exec('BEGIN IMMEDIATE');
    const info = db.prepare(`
      INSERT INTO customization_requests (
        reference, market, locale, customer_type, request_type, contact_name, company,
        email, phone, country, website, products_json, customizations_json,
        buyer_context_json, message, consent, status, internal_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'new', ?, ?, ?)
    `).run(
      reference(), text(body.market, 20) || 'en-gb', text(body.locale, 10) || 'en',
      customerType, requestType, contact.contact_name, contact.company || null,
      contact.email, contact.phone || null, contact.country, contact.website || null,
      JSON.stringify(products), JSON.stringify(customizations), JSON.stringify(buyerContext),
      contact.message || null,
      'Demo/test environment: stored locally for review. No SMTP, CRM or sales-system delivery is configured.',
      now, now,
    );
    requestId = Number(info.lastInsertRowid);
    const insertFile = db.prepare(`
      INSERT INTO customization_files (request_id, original_name, stored_name, mime_type, size_bytes, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const file of stored) {
      insertFile.run(requestId, file.original_name, file.stored_name, file.mime_type, file.size_bytes, file.sha256, now);
    }
    db.exec('COMMIT');
    const request = getCustomizationById(db, requestId);
    return { request, files: stored.length };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    cleanupFiles(stored);
    throw error;
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function mapRequest(row) {
  if (!row) return null;
  return {
    ...row,
    products: parseJson(row.products_json, []),
    customizations: parseJson(row.customizations_json, {}),
    buyerContext: parseJson(row.buyer_context_json, {}),
  };
}

function getCustomizationById(db, id) {
  const row = db.prepare('SELECT * FROM customization_requests WHERE id = ?').get(id);
  if (!row) return null;
  const request = mapRequest(row);
  request.files = db.prepare('SELECT id, original_name, stored_name, mime_type, size_bytes, sha256, created_at FROM customization_files WHERE request_id = ? ORDER BY id').all(id);
  return request;
}

function getCustomizationByReference(db, ref) {
  const row = db.prepare('SELECT * FROM customization_requests WHERE reference = ?').get(String(ref || ''));
  if (!row) return null;
  return getCustomizationById(db, row.id);
}

function listCustomizations(db, options = {}) {
  const where = ['1=1'];
  const params = {};
  if (options.market) { where.push('market = @market'); params.market = options.market; }
  if (options.customer_type) { where.push('customer_type = @customer_type'); params.customer_type = options.customer_type; }
  if (options.status) { where.push('status = @status'); params.status = options.status; }
  if (options.q) {
    where.push('(contact_name LIKE @q OR company LIKE @q OR email LIKE @q OR reference LIKE @q OR country LIKE @q)');
    params.q = `%${String(options.q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  const page = Math.max(1, Number(options.page) || 1);
  params.limit = limit;
  params.offset = (page - 1) * limit;
  const rows = db.prepare(`
    SELECT * FROM customization_requests WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC LIMIT @limit OFFSET @offset
  `).all(params).map(mapRequest);
  const countParams = { ...params };
  delete countParams.limit; delete countParams.offset;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM customization_requests WHERE ${where.join(' AND ')}`).get(countParams).c;
  return { rows, total, page, limit, pages: Math.ceil(total / limit) };
}

function updateCustomizationStatus(db, id, status, note) {
  if (!['new', 'review', 'quoted', 'closed', 'archived'].includes(status)) throw new ValidationError('status_invalid');
  db.prepare('UPDATE customization_requests SET status = ?, internal_note = ?, updated_at = ? WHERE id = ?')
    .run(status, text(note, 4000) || null, nowIso(), id);
  return getCustomizationById(db, id);
}

function exportCustomizations(db) {
  return db.prepare(`
    SELECT reference, created_at, market, locale, customer_type, request_type, contact_name,
           company, email, phone, country, products_json, customizations_json,
           buyer_context_json, message, status, internal_note
    FROM customization_requests ORDER BY created_at DESC
  `).all();
}

module.exports = {
  CUSTOMER_TYPES, REQUEST_TYPES, BUYER_FIELDS,
  createCustomizationRequest, getCustomizationByReference, getCustomizationById,
  listCustomizations, updateCustomizationStatus, exportCustomizations,
};

'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { nowIso, normalizeEmail, normalizeText, parseJson, truncate } = require('../lib/util');
const { ValidationError, RateLimitError } = require('../lib/app-error');
const { transaction } = require('../db');
const { inspectFiles, storeFiles, cleanupFiles } = require('./uploads');
const { deliver, deliveryLabel } = require('./email');
const { consume } = require('./rate-limit');
const { pushInquiry } = require('./crm');
const { getMarket } = require('../i18n/markets');
const { DOC_TYPES } = require('./documents');

const INQUIRY_TYPES = ['wholesale', 'oem', 'project', 'product_info', 'document_request', 'general'];
const MARKET_CODES = ['en-gb', 'de', 'ja-jp'];
const STATUSES = ['new', 'reviewing', 'need_more_info', 'quoted', 'negotiating', 'won', 'lost'];
const COMPANY_TYPES = ['importer', 'wholesaler', 'bathroom-brand', 'oem-partner', 'project-buyer', 'other'];
const PACKAGING_VALUES = ['inner-master', 'mixed-sku', 'private-label', 'pallet', 'to-confirm'];
const TERMS = ['FOB', 'CIF', 'DDP', 'to-confirm'];
const OEM_TYPES = ['oem', 'odm', 'private-label', 'contract'];
const NDA_VALUES = ['request-nda', 'nda-in-place', 'no-nda'];

const ALLOWED_FIELDS = {
  company_type: 80,
  product_interests: 1000,
  target_market: 120,
  packaging: 80,
  shipping_destination: 160,
  terms: 80,
  expected_order_date: 40,
  oem_project_type: 80,
  target_quantity: 120,
  oem_material: 500,
  oem_finish: 500,
  oem_dimensions: 500,
  oem_application: 300,
  oem_current_model: 200,
  oem_branding: 1000,
  oem_nda: 80,
  document_sku: 80,
  document_type: 80,
  document_market: 80,
  project_type: 120,
  project_phase: 200,
  project_name: 200,
  project_location: 200,
  product_categories: 500,
  estimated_quantity: 120,
  required_finish: 160,
  installation_requirements: 500,
  delivery_schedule: 300,
  trade_terms: 80,
  requested_finish: 160,
  requested_document: 160,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function generateReference(prefix = 'OL') {
  const date = new Date();
  const ym = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${prefix}-${ym}-${code}`;
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function parseConsent(value) {
  return /^(1|true|on|yes)$/i.test(String(value || ''));
}

function parseItems(db, input) {
  let raw = [];
  if (input.items_json) {
    const parsed = parseJson(input.items_json, null);
    if (!Array.isArray(parsed)) throw new ValidationError('items');
    raw = parsed;
  }
  if (!raw.length && input.product_sku) {
    raw = [{ sku: input.product_sku, quantity: input.quantity, notes: input.item_notes || '' }];
  }
  if (!raw.length) {
    // No-JavaScript fallback: product-picker checkboxes use the stable names
    // pick_<SKU>, qty_<SKU> and note_<SKU>.
    for (const [key, value] of Object.entries(input)) {
      if (!key.startsWith('pick_') || !/^(1|on|yes|true)$/i.test(String(value))) continue;
      const sku = key.slice(5);
      raw.push({ sku, quantity: input[`qty_${sku}`], notes: input[`note_${sku}`] || '' });
    }
  }
  if (raw.length > 10) throw new ValidationError('items');
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') throw new ValidationError('items');
    const sku = normalizeText(entry.sku, 80).toUpperCase();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const product = db.prepare('SELECT id, sku, published FROM products WHERE UPPER(sku) = ?').get(sku);
    if (!product || !product.published) throw new ValidationError('items');
    const quantity = Number.parseInt(entry.quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 1000000) throw new ValidationError('items');
    items.push({
      product_id: product.id,
      sku: product.sku,
      quantity,
      notes: normalizeText(entry.notes, 500),
    });
  }
  return items;
}

function validateInquiryInput(db, body, context = {}) {
  if (body.website || body.company_website || body.hp) {
    throw new ValidationError('honeypot');
  }
  const type = String(body.inquiry_type || context.defaultType || 'general').trim();
  if (!INQUIRY_TYPES.includes(type)) throw new ValidationError('unknown');
  const marketCode = String(body.market || context.market || 'en-gb').trim() || 'en-gb';
  if (!MARKET_CODES.includes(marketCode)) throw new ValidationError('unknown');
  const market = getMarket(marketCode);
  const name = normalizeText(body.name, 120);
  const email = normalizeEmail(body.email);
  const company = normalizeText(body.company, 200);
  const phone = normalizeText(body.phone, 80);
  const country = normalizeText(body.country, 120);
  const message = normalizeText(body.message, 5000);
  const consent = parseConsent(body.consent);

  if (name.length < 2) throw new ValidationError('name');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ValidationError('email');
  if (!country || country.length < 2) throw new ValidationError('country');
  if (message.length < 10) throw new ValidationError('message');
  if (!consent) throw new ValidationError('consent');
  if (['wholesale', 'oem', 'project', 'document_request'].includes(type) && company.length < 2) {
    throw new ValidationError('company');
  }

  const items = parseItems(db, body);
  if (type === 'product_info' && !items.length && !body.product_sku) {
    // A product information request can be general, so this is allowed.
  }
  if (type === 'project' && normalizeText(body.project_name, 200).length < 2) {
    throw new ValidationError('project_name');
  }
  if (['wholesale', 'project'].includes(type) && !items.length && !normalizeText(body.product_interests, 1000) && !normalizeText(body.product_categories, 500)) {
    throw new ValidationError('items');
  }

  const fields = {};
  for (const [key, max] of Object.entries(ALLOWED_FIELDS)) {
    const value = normalizeText(body[key], max);
    if (!value) continue;
    if (key === 'company_type' && !COMPANY_TYPES.includes(value)) continue;
    if (key === 'packaging' && !PACKAGING_VALUES.includes(value)) continue;
    if (key === 'terms' || key === 'trade_terms') {
      if (!TERMS.includes(value)) continue;
    }
    if (key === 'oem_project_type' && !OEM_TYPES.includes(value)) continue;
    if (key === 'oem_nda' && !NDA_VALUES.includes(value)) continue;
    if (key === 'document_type' && !DOC_TYPES.includes(value)) continue;
    if (key === 'expected_order_date' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && value !== 'to-confirm') continue;
    fields[key] = value;
  }

  const sourcePathCandidate = normalizeText(body.source_path || context.sourcePath || '', 300);
  const sourcePath = sourcePathCandidate.startsWith('/') && !sourcePathCandidate.startsWith('//')
    ? sourcePathCandidate
    : '/';

  return {
    type,
    name,
    company: company || null,
    email,
    phone: phone || null,
    country,
    market: market.code,
    locale: market.locale,
    source_page: sourcePath,
    source_path: sourcePath,
    message,
    consent: 1,
    items,
    fields,
    demo: config.isDemo,
  };
}

function consumeInquiryRateLimits(db, meta, email) {
  const ipLimit = meta.ipHash ? consume(db, `inq:ip:${meta.ipHash}`, 6, 10 * 60) : { allowed: true };
  if (!ipLimit.allowed) throw new RateLimitError('Too many inquiries from this connection.', ipLimit.retryAfter);
  const emailLimit = consume(db, `inq:email:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)}`, 10, 24 * 3600);
  if (!emailLimit.allowed) throw new RateLimitError('Too many inquiries for this email address.', emailLimit.retryAfter);
}

function createInquiry(db, body, meta = {}, rawFiles = [], context = {}) {
  const input = validateInquiryInput(db, body, context);
  consumeInquiryRateLimits(db, meta, input.email);
  const files = inspectFiles(rawFiles);
  const stored = storeFiles(files);
  let reference = generateReference('OL');
  try {
    const inquiry = transaction(db, () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const exists = db.prepare('SELECT 1 FROM inquiries WHERE reference = ?').get(reference);
        if (!exists) break;
        reference = generateReference('OL');
      }
      const created = nowIso();
      const retention = addMonths(new Date(), config.privacy.inquiryRetentionMonths).toISOString();
      const row = db.prepare(`
        INSERT INTO inquiries (
          reference, type, status, name, company, email, phone, country, market, locale,
          source_page, source_path, message, consent, consent_at, ip_hash, user_agent, device,
          assigned_to, created_at, updated_at, retention_until
        ) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        reference, input.type, input.name, input.company, input.email, input.phone, input.country,
        input.market, input.locale, input.source_page, input.source_path, input.message,
        created, meta.ipHash || null, meta.userAgent || null, meta.device || null,
        created, created, retention,
      );
      const inquiryId = Number(row.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO inquiry_items (inquiry_id, product_id, sku, product_name, quantity, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      input.items.forEach((item, index) => {
        const product = db.prepare(`
          SELECT COALESCE(pt.name, pte.name) AS name
          FROM products p
          LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = ?
          LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
          WHERE p.id = ?
        `).get(input.locale, item.product_id);
        insertItem.run(inquiryId, item.product_id, item.sku, product ? product.name : item.sku, item.quantity, item.notes || null, index + 1);
      });
      const insertField = db.prepare('INSERT INTO inquiry_fields (inquiry_id, field_key, value) VALUES (?, ?, ?)');
      for (const [key, value] of Object.entries(input.fields)) insertField.run(inquiryId, key, value);
      const insertFile = db.prepare(`
        INSERT INTO inquiry_attachments (inquiry_id, original_name, stored_name, mime_type, size_bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of stored) {
        insertFile.run(inquiryId, file.original_name, file.stored_name, file.mime_type, file.size_bytes, file.sha256, created);
      }
      db.prepare(`
        INSERT INTO inquiry_events (inquiry_id, user_id, event_type, from_value, to_value, meta_json, created_at)
        VALUES (?, NULL, 'created', NULL, 'new', ?, ?)
      `).run(inquiryId, JSON.stringify({ source: input.source_path, submissionType: input.type }), created);
      return db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId);
    });

    const items = db.prepare('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort_order').all(inquiry.id);
    const fields = Object.fromEntries(
      db.prepare('SELECT field_key, value FROM inquiry_fields WHERE inquiry_id = ?').all(inquiry.id)
        .map((row) => [row.field_key, row.value]),
    );
    const attachments = db.prepare('SELECT * FROM inquiry_attachments WHERE inquiry_id = ?').all(inquiry.id);
    let emailResults = { notification: 'not_configured', acknowledgement: 'not_configured', configured: false };
    deliver(db, inquiry, items, fields, attachments)
      .then((result) => { emailResults = result; })
      .catch((error) => {
        console.error('[email] delivery error', error.message);
      });
    // In demo/outbox mode delivery is synchronous; in SMTP mode the status may
    // become available just after the response. Read the recorded status now.
    const recorded = db.prepare(`
      SELECT kind, status FROM email_outbox WHERE inquiry_id = ? ORDER BY id DESC
    `).all(inquiry.id);
    const notificationStatus = recorded.find((r) => r.kind === 'notification')?.status;
    const ackStatus = recorded.find((r) => r.kind === 'acknowledgement')?.status;
    // Optional CRM delivery is best-effort and never blocks the stored inquiry.
    pushInquiry(inquiry, items, fields).then((crmResult) => {
      if (crmResult.configured) {
        db.prepare(`
          INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta_json, created_at)
          VALUES (NULL, 'crm_forward', 'inquiry', ?, ?, ?)
        `).run(String(inquiry.id), JSON.stringify(crmResult), nowIso());
      }
    }).catch((error) => console.error('[crm]', error.message));
    return {
      inquiry,
      items,
      fields,
      attachments,
      email: {
        configured: config.email.configured,
        notification: deliveryLabel(notificationStatus || emailResults.notification),
        acknowledgement: deliveryLabel(ackStatus || emailResults.acknowledgement),
      },
    };
  } catch (error) {
    cleanupFiles(stored);
    throw error;
  }
}

function getInquiryByReference(db, reference) {
  return db.prepare('SELECT * FROM inquiries WHERE reference = ?').get(String(reference || ''));
}

function listInquiries(db, options = {}) {
  const where = ['1=1'];
  const params = {};
  if (options.status) { where.push('i.status = @status'); params.status = options.status; }
  if (options.type) { where.push('i.type = @type'); params.type = options.type; }
  if (options.market) { where.push('i.market = @market'); params.market = options.market; }
  if (options.country) { where.push('i.country LIKE @country ESCAPE \'\\\''); params.country = `%${String(options.country).replace(/[\\%_]/g, (m) => `\\${m}`)}%`; }
  if (options.assignedTo) { where.push('i.assigned_to = @assignedTo'); params.assignedTo = options.assignedTo; }
  if (options.unassigned) where.push('i.assigned_to IS NULL');
  if (options.q) {
    where.push(`(i.reference LIKE @q ESCAPE '\\' OR i.name LIKE @q ESCAPE '\\' OR i.company LIKE @q ESCAPE '\\' OR i.email LIKE @q ESCAPE '\\' OR i.country LIKE @q ESCAPE '\\')`);
    params.q = `%${String(options.q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  if (options.from) { where.push('i.created_at >= @from'); params.from = new Date(`${options.from}T00:00:00.000Z`).toISOString(); }
  if (options.to) { where.push('i.created_at <= @to'); params.to = new Date(`${options.to}T23:59:59.999Z`).toISOString(); }
  const baseSelect = `
    SELECT i.*, u.display_name AS assignee_name,
      (SELECT COUNT(*) FROM inquiry_items it WHERE it.inquiry_id = i.id) AS item_count
    FROM inquiries i
    LEFT JOIN users u ON u.id = i.assigned_to
    WHERE ${where.join(' AND ')}
    ORDER BY CASE i.status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, i.created_at DESC
  `;
  if (options.all) {
    const rows = db.prepare(baseSelect).all(params);
    return { rows, total: rows.length, page: 1, limit: rows.length, pages: 1 };
  }
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const page = Math.max(1, Number(options.page) || 1);
  params.limit = limit;
  params.offset = (page - 1) * limit;
  const rows = db.prepare(`${baseSelect} LIMIT @limit OFFSET @offset`).all(params);
  const countParams = { ...params };
  delete countParams.limit;
  delete countParams.offset;
  const count = db.prepare(`SELECT COUNT(*) AS c FROM inquiries i WHERE ${where.join(' AND ')}`).get(countParams).c;
  return { rows, total: count, page, limit, pages: Math.ceil(count / limit) };
}

function getInquiryDetail(db, id) {
  const inquiry = db.prepare(`
    SELECT i.*, u.display_name AS assignee_name
    FROM inquiries i LEFT JOIN users u ON u.id = i.assigned_to
    WHERE i.id = ?
  `).get(id);
  if (!inquiry) return null;
  return {
    ...inquiry,
    items: db.prepare(`
      SELECT it.* FROM inquiry_items it WHERE it.inquiry_id = ? ORDER BY it.sort_order
    `).all(id),
    fields: db.prepare('SELECT * FROM inquiry_fields WHERE inquiry_id = ? ORDER BY field_key').all(id),
    attachments: db.prepare('SELECT * FROM inquiry_attachments WHERE inquiry_id = ? ORDER BY id').all(id),
    notes: db.prepare(`
      SELECT n.*, u.display_name AS author FROM inquiry_notes n
      LEFT JOIN users u ON u.id = n.user_id
      WHERE n.inquiry_id = ? ORDER BY n.created_at DESC
    `).all(id),
    events: db.prepare(`
      SELECT e.*, u.display_name AS author FROM inquiry_events e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.inquiry_id = ? ORDER BY e.created_at DESC
    `).all(id),
    emails: db.prepare('SELECT * FROM email_outbox WHERE inquiry_id = ? ORDER BY id').all(id),
  };
}

function createPrivacyRequest(db, body, meta = {}) {
  const email = normalizeEmail(body.email);
  const type = String(body.request_type || '').trim();
  const details = normalizeText(body.details, 3000);
  if (!EMAIL_RE.test(email)) throw new ValidationError('email');
  if (!['access', 'deletion', 'correction', 'objection'].includes(type)) throw new ValidationError('required');
  if (details.length < 10) throw new ValidationError('message');
  if (body.website) throw new ValidationError('honeypot');
  const rate = consume(db, `privacy:${crypto.createHash('sha256').update(`${email}|${meta.ipHash || ''}`).digest('hex').slice(0, 32)}`, 5, 24 * 3600);
  if (!rate.allowed) throw new RateLimitError('Too many privacy requests.', rate.retryAfter);
  let reference = generateReference('PR');
  for (let i = 0; i < 5; i += 1) {
    if (!db.prepare('SELECT 1 FROM privacy_requests WHERE reference = ?').get(reference)) break;
    reference = generateReference('PR');
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO privacy_requests (reference, email, request_type, details, status, created_at)
    VALUES (?, ?, ?, ?, 'new', ?)
  `).run(reference, email, type, details, now);
  return { reference, email, request_type: type, created_at: now };
}

function redactEmail(email) {
  return String(email || '').replace(/^(.{2}).*(@.*)$/, '$1***$2');
}

function inquirySummary(db, id) {
  return getInquiryDetail(db, id);
}

function statusLabel(status) {
  const labels = {
    new: 'New', reviewing: 'Reviewing', need_more_info: 'Need More Information',
    quoted: 'Quoted', negotiating: 'In Negotiation', won: 'Converted', lost: 'Closed', archived: 'Closed',
  };
  return labels[status] || status;
}

module.exports = {
  INQUIRY_TYPES, MARKET_CODES, STATUSES, ALLOWED_FIELDS,
  validateInquiryInput, createInquiry, getInquiryByReference, listInquiries,
  getInquiryDetail, createPrivacyRequest, statusLabel, generateReference, parseItems,
  redactEmail, inquirySummary, consumeInquiryRateLimits,
};

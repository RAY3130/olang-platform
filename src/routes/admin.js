'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { nowIso, normalizeEmail, normalizeText, slugify, clampInt, sha256, csv: legacyCsv } = require('../lib/util');
const { renderAdmin, renderFile, VIEWS } = require('../lib/view');
const { appendCookie, serializeCookie } = require('../lib/cookies');
const {
  attachAdmin, requireAdmin, createAdminSession, sessionCookie, clearSessionCookie,
  deleteSession, deleteUserSessions, loginCsrf, verifyLoginCsrf, safeNextPath,
  publicUser, can, ROLE_LABELS,
} = require('../auth');
const { hashPassword, verifyPassword, passwordProblems } = require('../auth/passwords');
const { requestMeta } = require('../lib/request');
const { consume } = require('../services/rate-limit');
const { getSetting, setSetting } = require('../services/settings');
const { dashboardData, listRecentEvents, exportEvents } = require('../services/analytics');
const { listProducts, getAllCategories, getProductById, ATTR_KEYS } = require('../services/products');
const {
  listInquiries, getInquiryDetail, STATUSES, INQUIRY_TYPES, statusLabel, redactEmail,
} = require('../services/inquiries');
const {
  listCustomizations, getCustomizationById, updateCustomizationStatus, exportCustomizations, CUSTOMER_TYPES,
} = require('../services/customization');
const { listDocuments, getDocumentById, documentTypeLabel, DOC_TYPES, DOC_STATUSES, VISIBILITIES, MARKETS } = require('../services/documents');
const { listFaqs, getFaq, getFaqTranslations, updateFaq, createFaq } = require('../services/faqs');
const { PAGE_MANIFEST, getPageDefault, contentEditorValues, saveContentFields } = require('../services/content');
const { MARKET_ORDER } = require('../i18n/markets');
const { topQuestions, unanswered } = require('../services/assistant');
const { allMarketSettings, updateMarketSettings, getFeaturedSkus, setFeaturedSkus } = require('../services/market-config');
const { inspectFiles, storeFiles, cleanupFiles, resolveStoredFile } = require('../services/uploads');
const { saveProductImage } = require('../services/public-images');
const { parseCsv, buildCsv } = require('../lib/csv');
const { audit, listAudit } = require('../admin/audit');
const enDict = require('../i18n/en');

const ADMIN_COOKIE = 'olang_admin';
const IMAGE_UPLOAD = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('image');
const DOC_UPLOAD = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single('document');
const CSV_UPLOAD = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('csv');

const ATTR_LABELS = enDict.attr;
const ROLE_OPTIONS = Object.entries(ROLE_LABELS);

function timestamp() { return nowIso(); }

function safeText(value, max = 5000) {
  return normalizeText(value, max);
}

function checkbox(value) {
  return /^(1|on|true|yes)$/i.test(String(value || ''));
}

function adminPage(req, res, view, data = {}, status = 200) {
  const queryNotice = req.query && (req.query.saved || req.query.created || req.query.updated);
  const notice = data.notice || (queryNotice ? 'Changes saved.' : '');
  res.status(status);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  return renderAdmin(res, view, {
    ...data,
    active: data.active || '',
    adminUser: req.admin ? req.admin.user : null,
    csrf: req.admin ? req.admin.csrfToken : '',
    notice: data.notice || notice,
    adminError: data.adminError || (req.query && req.query.error ? String(req.query.error).slice(0, 300) : ''),
    emailConfigured: config.email.configured,
    siteMode: config.siteMode,
    roleLabels: ROLE_LABELS,
    statusLabel,
  });
}

function safeQueryInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeAdminReturn(res, message, status = 403) {
  return res.status(status).render('admin/plain', { message }).catch(() => {
    res.status(status).type('text/plain').send(message);
  });
}

function csrfMatches(req) {
  if (!req.admin) return false;
  const supplied = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  const expected = req.admin.csrfToken;
  if (!supplied || !expected || String(supplied).length !== String(expected).length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(String(supplied)), Buffer.from(String(expected)));
  } catch (_) { return false; }
}

function requireAdminCsrf(req, res, next) {
  if (csrfMatches(req)) return next();
  return adminPage(req, res, 'error', {
    title: 'Security check failed',
    active: '',
    adminError: 'The security token expired. Go back, refresh the page and try again.',
  }, 403);
}

function adminUploadCsrf(uploadMiddleware) {
  return function upload(req, res, next) {
    uploadMiddleware(req, res, (error) => {
      if (error) {
        return adminPage(req, res, 'error', {
          title: 'Upload failed', active: '',
          adminError: error.code === 'LIMIT_FILE_SIZE' ? 'The file is too large.' : 'The upload could not be processed.',
        }, 422);
      }
      return requireAdminCsrf(req, res, next);
    });
  };
}

function gate(permission) {
  return function permissionGate(req, res, next) {
    if (can(req.admin.user, permission)) return next();
    return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
  };
}

function inquiryAccess(user) {
  return ['super_admin', 'sales_manager', 'sales_staff'].includes(user.role);
}

function managerAccess(user) {
  return user.role === 'super_admin' || user.role === 'sales_manager';
}

function isSuper(user) {
  return user.role === 'super_admin';
}

function statusCsv(rows) {
  return rows.map((row) => `${row.key}:${row.count}`).join(' | ');
}

function parseMarkets(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(values.filter((item) => MARKETS.includes(item) || item === 'global'))];
}

function categoryOptions(db) {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
}

function productOptions(db) {
  return db.prepare('SELECT id, sku, slug FROM products ORDER BY sku').all();
}

function adminUsers(db) {
  return db.prepare(`
    SELECT id, username, display_name, email, role, active FROM users
    WHERE role IN ('super_admin','sales_manager','sales_staff') AND active = 1
    ORDER BY display_name
  `).all();
}

function auditActor(req) {
  return req.admin ? req.admin.user : null;
}

function parseProductForm(db, body, existing) {
  const sku = safeText(body.sku, 40).toUpperCase();
  const categoryId = safeQueryInteger(body.category_id, 0);
  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!sku || !/^[A-Z0-9._-]{2,40}$/.test(sku)) throw new Error('SKU must contain 2–40 letters, numbers, dots, underscores or hyphens.');
  if (!category) throw new Error('Select a valid product category.');
  const nameEn = safeText(body.name_en, 200);
  if (!nameEn) throw new Error('The English product name is required.');
  const slug = slugify(body.slug || `${nameEn}-${sku}`) || slugify(sku);
  if (!slug) throw new Error('A valid URL slug is required.');
  const sourceUrl = safeText(body.source_url, 500);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('Source URL must start with http:// or https://.');
  return {
    sku,
    slug,
    category_id: categoryId,
    series: safeText(body.series, 120) || null,
    collection: safeText(body.collection, 80) || null,
    image_path: existing && existing.image_path ? existing.image_path : null,
    published: checkbox(body.published) ? 1 : 0,
    sort_order: clampInt(body.sort_order, 0, 100000, 100),
    source_url: sourceUrl || null,
    source_checked_at: safeText(body.source_checked_at, 20) || null,
    source_note: safeText(body.source_note, 2000) || null,
    nameEn,
  };
}

function upsertTranslations(db, productId, body) {
  for (const locale of ['en', 'de', 'it', 'ja']) {
    const name = safeText(body[`name_${locale}`], 200);
    const short = safeText(body[`short_${locale}`], 500);
    const description = safeText(body[`description_${locale}`], 6000);
    const seoTitle = safeText(body[`seo_title_${locale}`], 200);
    const seoDescription = safeText(body[`seo_description_${locale}`], 320);
    const status = ['draft', 'ai_draft', 'reviewed', 'approved'].includes(body[`translation_status_${locale}`])
      ? body[`translation_status_${locale}`] : 'draft';
    if (!name) {
      if (locale !== 'en') db.prepare('DELETE FROM product_translations WHERE product_id = ? AND locale = ?').run(productId, locale);
      continue;
    }
    db.prepare(`
      INSERT INTO product_translations (product_id, locale, name, short_description, description, seo_title, seo_description, translation_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id, locale) DO UPDATE SET
        name = excluded.name, short_description = excluded.short_description,
        description = excluded.description, seo_title = excluded.seo_title,
        seo_description = excluded.seo_description, translation_status = excluded.translation_status
    `).run(productId, locale, name, short, description, seoTitle, seoDescription, status);
  }
}

function upsertAttributes(db, productId, body) {
  const now = timestamp();
  ATTR_KEYS.forEach((key, index) => {
    const value = safeText(body[`attr_${key}_value`], 2000);
    const unit = safeText(body[`attr_${key}_unit`], 30);
    const status = ['verified', 'company_provided', 'confirmed', 'pending_verification', 'available_on_request', 'not_applicable', 'customizable'].includes(body[`attr_${key}_status`])
      ? body[`attr_${key}_status`] : 'available_on_request';
    const note = safeText(body[`attr_${key}_note`], 2000);
    const source = safeText(body[`attr_${key}_source`], 500);
    const verifiedAt = safeText(body[`attr_${key}_verified_at`], 20);
    const internalNote = safeText(body[`attr_${key}_internal_note`], 2000);
    const visible = checkbox(body[`attr_${key}_visible`]) ? 1 : 0;
    db.prepare(`
      INSERT INTO product_attributes (
        product_id, attr_key, value, unit, status, source_note, data_source,
        last_verified_at, internal_note, visible_frontend, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id, attr_key) DO UPDATE SET
        value = excluded.value, unit = excluded.unit, status = excluded.status,
        source_note = excluded.source_note, data_source = excluded.data_source,
        last_verified_at = excluded.last_verified_at, internal_note = excluded.internal_note,
        visible_frontend = excluded.visible_frontend, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).run(
      productId, key, value || null, unit || null, status, note || null, source || null,
      verifiedAt || null, internalNote || null, visible, index, now,
    );
  });
}

function upsertFinishes(db, productId, body) {
  const finishes = db.prepare('SELECT id, code, name_en FROM finishes ORDER BY sort_order').all();
  const selected = [];
  for (const finish of finishes) {
    db.prepare('DELETE FROM product_finishes WHERE product_id = ? AND finish_id = ?').run(productId, finish.id);
    if (checkbox(body[`finish_${finish.code}`])) {
      db.prepare(`
        INSERT INTO product_finishes (product_id, finish_id, status, note)
        VALUES (?, ?, 'company_provided', ?)
      `).run(productId, finish.id, 'Admin selection; coating standard and test evidence remain unverified.');
      selected.push(finish.name_en);
    }
  }
  if (selected.length) {
    db.prepare(`
      UPDATE product_attributes SET value = ?, status = 'company_provided', updated_at = ? WHERE product_id = ? AND attr_key = 'finish'
    `).run(selected.join(', '), timestamp(), productId);
  }
}

function productAdminData(db, id) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return null;
  const translations = db.prepare('SELECT * FROM product_translations WHERE product_id = ?').all(id);
  const translationMap = {};
  translations.forEach((row) => { translationMap[row.locale] = row; });
  const attrs = db.prepare('SELECT * FROM product_attributes WHERE product_id = ?').all(id);
  const attrMap = {};
  attrs.forEach((row) => { attrMap[row.attr_key] = row; });
  const selectedFinishes = new Set(db.prepare('SELECT f.code FROM product_finishes pf JOIN finishes f ON f.id = pf.finish_id WHERE pf.product_id = ?').all(id).map((row) => row.code));
  return {
    product,
    translations: translationMap,
    attrMap,
    finishes: db.prepare('SELECT * FROM finishes ORDER BY sort_order').all(),
    selectedFinishes,
    categories: categoryOptions(db),
    documents: listDocuments(db, { includeInternal: true }).filter((doc) => doc.product_id === id),
    attrKeys: ATTR_KEYS,
    attrLabels: ATTR_LABELS,
  };
}

module.exports = function adminRoutes(db) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(attachAdmin(db));

  router.get('/login', (req, res, next) => {
    if (req.admin) return res.redirect('/admin');
    const token = loginCsrf(req, res);
    return renderFile(path.join(VIEWS, 'admin', 'login.ejs'), {
      csrf: token, error: '', username: '', next: safeNextPath(req.query.next),
      assetVersion: req.app.locals.assetVersion,
    }).then((html) => res.send(html)).catch(next);
  });

  router.post('/login', (req, res, next) => {
    try {
      if (!verifyLoginCsrf(req)) {
        return renderFile(path.join(VIEWS, 'admin', 'login.ejs'), {
          csrf: loginCsrf(req, res), error: 'Security token expired. Try again.', username: safeText(req.body.username, 100), next: safeNextPath(req.body.next),
          assetVersion: req.app.locals.assetVersion,
        }).then((html) => res.status(403).send(html)).catch(next);
      }
      const username = safeText(req.body.username, 100);
      const password = String(req.body.password || '');
      const salt = getSetting(db, 'security.ip_hash_salt', '');
      const meta = requestMeta(req, salt);
      const ipRate = consume(db, `admin-login-ip:${meta.ipHash}`, 30, 15 * 60);
      const rate = consume(db, `admin-login:${meta.ipHash}:${sha256(username).slice(0, 16)}`, 8, 15 * 60);
      if (!ipRate.allowed || !rate.allowed) {
        return renderFile(path.join(VIEWS, 'admin', 'login.ejs'), {
          csrf: loginCsrf(req, res), error: 'Too many sign-in attempts. Wait 15 minutes and try again.', username, next: safeNextPath(req.body.next),
          assetVersion: req.app.locals.assetVersion,
        }).then((html) => res.status(429).send(html)).catch(next);
      }
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        audit(db, user ? publicUser(user) : null, 'login_failed', 'user', user ? user.id : null, { username });
        return renderFile(path.join(VIEWS, 'admin', 'login.ejs'), {
          csrf: loginCsrf(req, res), error: 'The username or password is not correct.', username, next: safeNextPath(req.body.next),
          assetVersion: req.app.locals.assetVersion,
        }).then((html) => res.status(401).send(html)).catch(next);
      }
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(timestamp(), user.id);
      const session = createAdminSession(db, user.id, meta);
      appendCookie(res, sessionCookie(session.token, session.expires));
      appendCookie(res, serializeCookie('olang_login_csrf', '', {
        httpOnly: false, secure: config.sessionCookieSecure, sameSite: 'Strict', path: '/admin', maxAge: 0,
      }));
      audit(db, publicUser(user), 'login', 'user', user.id, {});
      return res.redirect(303, safeNextPath(req.body.next));
    } catch (error) { return next(error); }
  });

  router.use(requireAdmin);
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    // Multipart forms are parsed by the route-specific multer middleware, then
    // their CSRF token is checked by adminUploadCsrf.
    if (req.is('multipart/form-data')) return next();
    return requireAdminCsrf(req, res, next);
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies[ADMIN_COOKIE];
    deleteSession(db, token);
    appendCookie(res, clearSessionCookie());
    audit(db, req.admin.user, 'logout', 'user', req.admin.user.id, {});
    return res.redirect(303, '/admin/login');
  });

  router.use((req, res, next) => {
    if (req.admin.user.mustChangePassword && req.path !== '/password') {
      return res.redirect(303, '/admin/password');
    }
    return next();
  });

  router.get('/password', (req, res) => adminPage(req, res, 'password', { title: 'Change password', active: 'password' }));

  router.post('/password', (req, res) => {
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.admin.user.id);
    const current = String(req.body.current_password || '');
    const nextPassword = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    if (!verifyPassword(current, userRow.password_hash)) {
      return adminPage(req, res, 'password', { title: 'Change password', active: 'password', adminError: 'The current password is not correct.' }, 422);
    }
    const problems = passwordProblems(nextPassword, userRow.username);
    if (nextPassword !== confirm) problems.push('The new passwords do not match.');
    if (problems.length) {
      return adminPage(req, res, 'password', { title: 'Change password', active: 'password', adminError: problems.join(' ') }, 422);
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(hashPassword(nextPassword), timestamp(), userRow.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userRow.id, req.admin.sessionId);
    audit(db, req.admin.user, 'password_changed', 'user', userRow.id, {});
    return adminPage(req, res, 'password', { title: 'Change password', active: 'password', notice: 'Password updated. Other sessions have been signed out.' });
  });

  // Dashboard -----------------------------------------------------------------
  router.get('/', gate('dashboard'), (req, res) => {
    const user = req.admin.user;
    const analytics = ['super_admin', 'sales_manager'].includes(user.role) ? dashboardData(db, { days: req.query.days || '30' }) : null;
    const counts = {
      products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
      published: db.prepare('SELECT COUNT(*) c FROM products WHERE published = 1').get().c,
      documents: db.prepare('SELECT COUNT(*) c FROM documents').get().c,
      pendingDocs: db.prepare("SELECT COUNT(*) c FROM documents WHERE status <> 'available'").get().c,
      faqs: db.prepare('SELECT COUNT(*) c FROM faqs WHERE published = 1').get().c,
      translations: db.prepare("SELECT COUNT(*) c FROM product_translations WHERE translation_status IN ('ai_draft','draft')").get().c,
      inquiries: db.prepare('SELECT COUNT(*) c FROM inquiries WHERE is_test = 0').get().c,
      newInquiries: db.prepare("SELECT COUNT(*) c FROM inquiries WHERE status = 'new' AND is_test = 0").get().c,
    };
    const ownInquiries = user.role === 'sales_staff'
      ? listInquiries(db, { assignedTo: user.id, limit: 8, page: 1 })
      : (inquiryAccess(user) ? listInquiries(db, { limit: 8, page: 1 }) : { rows: [], total: 0 });
    const outbox = db.prepare(`
      SELECT status, COUNT(*) AS count FROM email_outbox GROUP BY status ORDER BY count DESC
    `).all();
    const assistantTop = topQuestions(db, 8);
    const assistantUnanswered = unanswered(db, 6);
    return adminPage(req, res, 'dashboard', {
      title: 'Dashboard', active: 'dashboard', analytics, counts, ownInquiries, outbox,
      assistantTop, assistantUnanswered,
      canAnalytics: Boolean(analytics), canInquiries: inquiryAccess(user),
      baseline: getSetting(db, 'analytics.baseline_started_at', null),
    });
  });

  // Products ------------------------------------------------------------------
  router.get('/analytics/export.csv', (req, res) => {
    if (!['super_admin', 'sales_manager'].includes(req.admin.user.role)) return res.status(403).send('Forbidden');
    const rows = exportEvents(db);
    const columns = [
      { label: 'event_id', value: (row) => row.event_id },
      { label: 'event_name', value: (row) => row.event_name },
      { label: 'created_at', value: (row) => row.created_at },
      { label: 'path', value: (row) => row.path },
      { label: 'page_type', value: (row) => row.page_type },
      { label: 'market', value: (row) => row.market },
      { label: 'locale', value: (row) => row.locale },
      { label: 'product_sku', value: (row) => row.product_sku },
      { label: 'device', value: (row) => row.device },
      { label: 'country', value: (row) => row.country },
      { label: 'referrer', value: (row) => row.referrer },
      { label: 'props_json', value: (row) => row.props_json },
    ];
    audit(db, req.admin.user, 'analytics_exported', 'analytics', null, { count: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="olang-events.csv"');
    return res.send(buildCsv(rows, columns));
  });

  router.get('/products', gate('products'), (req, res) => {
    const q = safeText(req.query.q, 120);
    const category = safeText(req.query.category, 80);
    const published = req.query.published === '0' ? 0 : req.query.published === '1' ? 1 : null;
    const where = ['1=1'];
    const params = {};
    if (q) {
      where.push(`(p.sku LIKE @q ESCAPE '\\' OR p.slug LIKE @q ESCAPE '\\' OR pt.name LIKE @q ESCAPE '\\')`);
      params.q = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    }
    if (category) { where.push('c.key = @category'); params.category = category; }
    if (published !== null) { where.push('p.published = @published'); params.published = published; }
    const rows = db.prepare(`
      SELECT p.*, c.key AS category_key,
        COALESCE(pt.name, pte.name) AS name,
        COALESCE(pt.translation_status, 'draft') AS translation_status,
        (SELECT COUNT(*) FROM product_attributes pa WHERE pa.product_id = p.id AND pa.value IS NOT NULL AND pa.value <> '') AS filled_attributes,
        (SELECT COUNT(*) FROM documents d WHERE d.product_id = p.id) AS document_count
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'en'
      LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
      WHERE ${where.join(' AND ')}
      ORDER BY p.sort_order, p.id
    `).all(params);
    return adminPage(req, res, 'products', {
      title: 'Products', active: 'products', products: rows, categories: categoryOptions(db),
      filters: { q, category, published: published === null ? '' : String(published) },
      importErrors: [], importResult: null,
    });
  });

  router.get('/assets', gate('products'), (req, res) => {
    const assets = db.prepare(`
      SELECT a.*, p.sku AS product_sku, p.slug AS product_slug
      FROM image_assets a
      LEFT JOIN products p ON p.id = a.product_id
      ORDER BY a.kind, a.path
    `).all();
    return adminPage(req, res, 'image-assets', {
      title: 'Image assets', active: 'assets', assets,
    });
  });

  router.get('/products/export.csv', gate('products'), (req, res) => {
    const products = db.prepare(`
      SELECT p.*, c.key AS category_key,
        pt.name AS name_en, pt.short_description AS short_en, pt.description AS description_en,
        pt.seo_title AS seo_title_en, pt.seo_description AS seo_description_en,
        pdt.name AS name_de, pit.name AS name_it
      FROM products p JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'en'
      LEFT JOIN product_translations pdt ON pdt.product_id = p.id AND pdt.locale = 'de'
      LEFT JOIN product_translations pit ON pit.product_id = p.id AND pit.locale = 'it'
      ORDER BY p.sort_order, p.id
    `).all();
    const attrs = db.prepare('SELECT * FROM product_attributes ORDER BY product_id, sort_order').all();
    const attrsByProduct = {};
    attrs.forEach((attr) => {
      if (!attrsByProduct[attr.product_id]) attrsByProduct[attr.product_id] = {};
      attrsByProduct[attr.product_id][attr.attr_key] = attr.value || '';
    });
    const columns = [
      { label: 'sku', value: (r) => r.sku }, { label: 'slug', value: (r) => r.slug },
      { label: 'category_key', value: (r) => r.category_key }, { label: 'series', value: (r) => r.series || '' },
      { label: 'published', value: (r) => r.published }, { label: 'image_path', value: (r) => r.image_path || '' },
      { label: 'name_en', value: (r) => r.name_en || '' }, { label: 'name_de', value: (r) => r.name_de || '' }, { label: 'name_it', value: (r) => r.name_it || '' },
      { label: 'short_en', value: (r) => r.short_en || '' }, { label: 'description_en', value: (r) => r.description_en || '' },
      { label: 'seo_title_en', value: (r) => r.seo_title_en || '' }, { label: 'seo_description_en', value: (r) => r.seo_description_en || '' },
      { label: 'source_url', value: (r) => r.source_url || '' }, { label: 'source_checked_at', value: (r) => r.source_checked_at || '' },
    ];
    ATTR_KEYS.forEach((key) => columns.push({ label: `attr_${key}`, value: (r) => (attrsByProduct[r.id] || {})[key] || '' }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="olang-products.csv"');
    res.send(buildCsv(products, columns));
  });

  router.post('/products/import', gate('products'), adminUploadCsrf(CSV_UPLOAD), (req, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return adminPage(req, res, 'products', {
          title: 'Products', active: 'products', products: [], categories: categoryOptions(db),
          filters: { q: '', category: '', published: '' }, importErrors: ['Choose a CSV file.'], importResult: null,
        }, 422);
      }
      let rows;
      try { rows = parseCsv(req.file.buffer.toString('utf8')); } catch (error) { rows = []; }
      if (!rows.length) {
        return adminPage(req, res, 'products', {
          title: 'Products', active: 'products', products: [], categories: categoryOptions(db),
          filters: { q: '', category: '', published: '' }, importErrors: ['The CSV has no data rows.'], importResult: null,
        }, 422);
      }
      const errors = [];
      let imported = 0;
      for (const [index, row] of rows.entries()) {
        const sku = safeText(row.sku, 40).toUpperCase();
        const categoryKey = safeText(row.category_key, 80);
        const categoryRow = db.prepare('SELECT id FROM categories WHERE key = ?').get(categoryKey);
        if (!sku || !row.name_en || !categoryRow) {
          errors.push(`Row ${index + 2}: sku, name_en and a valid category_key are required.`);
          continue;
        }
        const slug = slugify(row.slug || `${row.name_en}-${sku}`) || slugify(sku);
        const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
        if (existing) {
          db.prepare(`
            UPDATE products SET slug = ?, category_id = ?, series = ?, image_path = ?, published = ?, source_url = ?, source_checked_at = ?, updated_at = ? WHERE id = ?
          `).run(slug, categoryRow.id, safeText(row.series, 120) || null, safeText(row.image_path, 300) || null,
            checkbox(row.published) || row.published === '1' ? 1 : 0, safeText(row.source_url, 500) || null,
            safeText(row.source_checked_at, 20) || null, timestamp(), existing.id);
          imported += 1;
        } else {
          const info = db.prepare(`
            INSERT INTO products (sku, slug, category_id, series, image_path, published, sort_order, source_url, source_checked_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?)
          `).run(sku, slug, categoryRow.id, safeText(row.series, 120) || null, safeText(row.image_path, 300) || null,
            checkbox(row.published) || row.published === '1' ? 1 : 0, safeText(row.source_url, 500) || null,
            safeText(row.source_checked_at, 20) || null, timestamp(), timestamp());
          const id = Number(info.lastInsertRowid);
          ATTR_KEYS.forEach((key, attrIndex) => {
            db.prepare(`
              INSERT INTO product_attributes (product_id, attr_key, value, status, sort_order, updated_at)
              VALUES (?, ?, NULL, 'available_on_request', ?, ?)
            `).run(id, key, attrIndex, timestamp());
          });
          imported += 1;
        }
        const product = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
        for (const [locale, suffix] of [['en', 'en'], ['de', 'de'], ['it', 'it']]) {
          const name = safeText(row[`name_${suffix}`], 200);
          if (!name) continue;
          db.prepare(`
            INSERT INTO product_translations (product_id, locale, name, short_description, description, seo_title, seo_description, translation_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id, locale) DO UPDATE SET name = excluded.name,
              short_description = CASE WHEN excluded.short_description <> '' THEN excluded.short_description ELSE product_translations.short_description END,
              description = CASE WHEN excluded.description <> '' THEN excluded.description ELSE product_translations.description END,
              translation_status = excluded.translation_status
          `).run(product.id, locale, name, safeText(row[`short_${suffix}`], 500), safeText(row[`description_${suffix}`], 6000),
            locale === 'en' ? safeText(row.seo_title_en, 200) : '', locale === 'en' ? safeText(row.seo_description_en, 320) : '', locale === 'en' ? 'reviewed' : 'ai_draft');
        }
      }
      audit(db, req.admin.user, 'products_imported', 'product', null, { imported, rows: rows.length });
      const products = db.prepare(`
        SELECT p.*, c.key AS category_key, COALESCE(pt.name, pte.name) AS name,
          COALESCE(pt.translation_status, 'draft') AS translation_status,
          (SELECT COUNT(*) FROM product_attributes pa WHERE pa.product_id = p.id AND pa.value IS NOT NULL AND pa.value <> '') AS filled_attributes,
          (SELECT COUNT(*) FROM documents d WHERE d.product_id = p.id) AS document_count
        FROM products p JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'en'
        LEFT JOIN product_translations pte ON pte.product_id = p.id AND pte.locale = 'en'
        ORDER BY p.sort_order, p.id
      `).all();
      return adminPage(req, res, 'products', {
        title: 'Products', active: 'products', products, categories: categoryOptions(db),
        filters: { q: '', category: '', published: '' },
        importErrors: errors, importResult: { imported, total: rows.length },
      });
    } catch (error) { return next(error); }
  });

  router.get('/products/new', gate('products'), (req, res) => {
    const data = {
      product: null, translations: {}, attrMap: {}, finishes: db.prepare('SELECT * FROM finishes ORDER BY sort_order').all(),
      selectedFinishes: new Set(), categories: categoryOptions(db), documents: [], attrKeys: ATTR_KEYS, attrLabels: ATTR_LABELS,
    };
    return adminPage(req, res, 'product-form', { title: 'New product', active: 'products', ...data });
  });

  router.get('/products/:id', gate('products'), (req, res) => {
    const data = productAdminData(db, Number(req.params.id));
    if (!data) return adminPage(req, res, 'error', { title: 'Product not found', active: 'products', adminError: 'Product not found.' }, 404);
    return adminPage(req, res, 'product-form', { title: `${data.product.sku} · Edit product`, active: 'products', ...data });
  });

  function saveProduct(req, res, existing) {
    try {
      const parsed = parseProductForm(db, req.body, existing);
      if (req.file) parsed.image_path = saveProductImage(req.file);
      if (existing && req.body.remove_image === '1') parsed.image_path = null;
      let productId;
      if (existing) {
        db.prepare(`
          UPDATE products SET sku = ?, slug = ?, category_id = ?, series = ?, collection = ?, image_path = ?, published = ?,
            sort_order = ?, source_url = ?, source_checked_at = ?, source_note = ?, updated_at = ? WHERE id = ?
        `).run(parsed.sku, parsed.slug, parsed.category_id, parsed.series, parsed.collection, parsed.image_path, parsed.published,
          parsed.sort_order, parsed.source_url, parsed.source_checked_at, parsed.source_note, timestamp(), existing.id);
        productId = existing.id;
      } else {
        const info = db.prepare(`
          INSERT INTO products (sku, slug, category_id, series, collection, image_path, published, sort_order, source_url, source_checked_at, source_note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(parsed.sku, parsed.slug, parsed.category_id, parsed.series, parsed.collection, parsed.image_path, parsed.published,
          parsed.sort_order, parsed.source_url, parsed.source_checked_at, parsed.source_note, timestamp(), timestamp());
        productId = Number(info.lastInsertRowid);
      }
      upsertTranslations(db, productId, req.body);
      upsertAttributes(db, productId, req.body);
      upsertFinishes(db, productId, req.body);
      audit(db, req.admin.user, existing ? 'product_updated' : 'product_created', 'product', productId, { sku: parsed.sku });
      return res.redirect(303, `/admin/products/${productId}?saved=1`);
    } catch (error) {
      const msg = /UNIQUE constraint failed/.test(error.message) ? 'That SKU or URL slug is already used.' : error.message;
      const data = existing ? productAdminData(db, existing.id) : {
        product: null, translations: {}, attrMap: {}, finishes: db.prepare('SELECT * FROM finishes ORDER BY sort_order').all(),
        selectedFinishes: new Set(), categories: categoryOptions(db), documents: [], attrKeys: ATTR_KEYS, attrLabels: ATTR_LABELS,
      };
      return adminPage(req, res, 'product-form', {
        title: existing ? `${existing.sku} · Edit product` : 'New product', active: 'products',
        ...data, adminError: msg, formBody: req.body,
      }, 422);
    }
  }

  router.post('/products/new', gate('products'), adminUploadCsrf(IMAGE_UPLOAD), (req, res) => saveProduct(req, res, null));
  router.post('/products/:id', gate('products'), adminUploadCsrf(IMAGE_UPLOAD), (req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
    if (!existing) return adminPage(req, res, 'error', { title: 'Product not found', active: 'products', adminError: 'Product not found.' }, 404);
    return saveProduct(req, res, existing);
  });

  router.post('/products/:id/delete', gate('products'), (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
    if (!product) return adminPage(req, res, 'error', { title: 'Product not found', active: 'products', adminError: 'Product not found.' }, 404);
    if (String(req.body.confirm || '') !== product.sku) {
      return adminPage(req, res, 'product-form', {
        ...productAdminData(db, product.id), title: `${product.sku} · Edit product`, active: 'products',
        adminError: `Type the SKU (${product.sku}) exactly to delete this product.`,
      }, 422);
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    audit(db, req.admin.user, 'product_deleted', 'product', product.id, { sku: product.sku });
    return res.redirect(303, '/admin/products?saved=1');
  });

  // Categories ---------------------------------------------------------------
  router.get('/categories', gate('products'), (req, res) => {
    const categories = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
      FROM categories c ORDER BY c.sort_order, c.id
    `).all();
    const translations = {};
    db.prepare('SELECT * FROM category_translations').all().forEach((row) => {
      if (!translations[row.category_id]) translations[row.category_id] = {};
      translations[row.category_id][row.locale] = row;
    });
    return adminPage(req, res, 'categories', { title: 'Categories', active: 'categories', categories, translations });
  });

  router.post('/categories', gate('products'), (req, res) => {
    const key = slugify(req.body.key || req.body.name_en);
    const slug = slugify(req.body.slug || req.body.name_en || key);
    const nameEn = safeText(req.body.name_en, 120);
    if (!key || !slug || !nameEn) return adminPage(req, res, 'categories', { title: 'Categories', active: 'categories', adminError: 'Key, slug and English name are required.' }, 422);
    try {
      const info = db.prepare(`
        INSERT INTO categories (key, slug, sort_order, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
      `).run(key, slug, clampInt(req.body.sort_order, 0, 1000, 100), timestamp(), timestamp());
      const id = Number(info.lastInsertRowid);
      for (const locale of ['en', 'de', 'it', 'ja']) {
        const name = safeText(req.body[`name_${locale}`], 120) || (locale === 'en' ? nameEn : '');
        if (name) db.prepare('INSERT INTO category_translations (category_id, locale, name) VALUES (?, ?, ?)').run(id, locale, name);
      }
      audit(db, req.admin.user, 'category_created', 'category', id, { key });
      return res.redirect(303, '/admin/categories?saved=1');
    } catch (error) {
      return adminPage(req, res, 'categories', {
        title: 'Categories', active: 'categories', adminError: 'The category key or slug is already in use.',
        categories: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.sort_order').all(), translations: {},
      }, 422);
    }
  });

  router.post('/categories/:id', gate('products'), (req, res) => {
    const id = Number(req.params.id);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!category) return adminPage(req, res, 'error', { title: 'Category not found', active: 'categories', adminError: 'Category not found.' }, 404);
    db.prepare('UPDATE categories SET slug = ?, sort_order = ?, published = ?, updated_at = ? WHERE id = ?')
      .run(slugify(req.body.slug || category.slug), clampInt(req.body.sort_order, 0, 1000, 0), checkbox(req.body.published) ? 1 : 0, timestamp(), id);
    for (const locale of ['en', 'de', 'it', 'ja']) {
      const name = safeText(req.body[`name_${locale}`], 120);
      if (!name) continue;
      db.prepare(`
        INSERT INTO category_translations (category_id, locale, name, description, seo_title, seo_description)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(category_id, locale) DO UPDATE SET name = excluded.name, description = excluded.description,
          seo_title = excluded.seo_title, seo_description = excluded.seo_description
      `).run(id, locale, name, safeText(req.body[`description_${locale}`], 1000), safeText(req.body[`seo_title_${locale}`], 200), safeText(req.body[`seo_description_${locale}`], 320));
    }
    audit(db, req.admin.user, 'category_updated', 'category', id, {});
    return res.redirect(303, '/admin/categories?saved=1');
  });

  // Markets -----------------------------------------------------------------
  function marketAdminData(db) {
    const products = listProducts(db, { locale: 'en' });
    const markets = allMarketSettings(db, 'en');
    const featured = Object.fromEntries(markets.map((market) => [market.code, getFeaturedSkus(db, market.code)]));
    return { markets, products, featured };
  }

  router.get('/markets', gate('content'), (req, res) => {
    return adminPage(req, res, 'markets', {
      title: 'Market configuration',
      active: 'markets',
      ...marketAdminData(db),
    });
  });

  router.post('/markets/:code', gate('content'), (req, res) => {
    const code = String(req.params.code);
    if (!MARKET_ORDER.includes(code)) {
      return adminPage(req, res, 'markets', {
        title: 'Market configuration', active: 'markets', adminError: 'Unknown market edition.',
        ...marketAdminData(db),
      }, 422);
    }
    try {
      updateMarketSettings(db, code, req.body);
      const skus = String(req.body.featured_skus || '').split(/[,\s]+/).map((sku) => sku.trim().toUpperCase()).filter(Boolean).slice(0, 12);
      setFeaturedSkus(db, code, skus);
      audit(db, req.admin.user, 'market_updated', 'market', code, { featured: skus });
      return res.redirect(303, '/admin/markets?saved=1');
    } catch (error) {
      return adminPage(req, res, 'markets', {
        title: 'Market configuration', active: 'markets', adminError: error.message,
        ...marketAdminData(db),
      }, 422);
    }
  });

  // Assistant knowledge base -------------------------------------------------
  router.get('/assistant', gate('content'), (req, res) => {
    return adminPage(req, res, 'assistant', {
      title: 'Product assistant',
      active: 'assistant',
      mode: config.assistant.enabled ? 'LLM + approved retrieval' : 'Approved-retrieval rules',
      llmConfigured: config.assistant.enabled,
      top: topQuestions(db, 25),
      unansweredRows: unanswered(db, 25),
      faqCount: db.prepare('SELECT COUNT(*) AS c FROM faqs WHERE published = 1').get().c,
      productCount: db.prepare('SELECT COUNT(*) AS c FROM products WHERE published = 1').get().c,
      assistantCopy: {
        fallback: ['en', 'de', 'it', 'ja'].map((locale) => ({ locale, value: getSetting(db, `assistant.fallback.${locale}`, '') })),
        handoff: ['en', 'de', 'it', 'ja'].map((locale) => ({ locale, value: getSetting(db, `assistant.handoff.${locale}`, '') })),
      },
    });
  });

  router.post('/assistant', gate('content'), (req, res) => {
    for (const locale of ['en', 'de', 'it', 'ja']) {
      setSetting(db, `assistant.fallback.${locale}`, safeText(req.body[`fallback_${locale}`], 1200));
      setSetting(db, `assistant.handoff.${locale}`, safeText(req.body[`handoff_${locale}`], 1200));
    }
    audit(db, req.admin.user, 'assistant_rules_updated', 'assistant', null, {});
    return res.redirect(303, '/admin/assistant?saved=1');
  });

  // Content ------------------------------------------------------------------
  router.get('/content', gate('content'), (req, res) => {
    return adminPage(req, res, 'content-list', {
      title: 'Content', active: 'content',
      pages: Object.entries(PAGE_MANIFEST).map(([key, value]) => ({ key, ...value })),
      assistantTop: topQuestions(db, 12), assistantUnanswered: unanswered(db, 8),
    });
  });

  router.get('/content/:pageKey', gate('content'), (req, res) => {
    const pageKey = String(req.params.pageKey);
    if (!PAGE_MANIFEST[pageKey]) return adminPage(req, res, 'error', { title: 'Content page not found', active: 'content', adminError: 'Content page not found.' }, 404);
    const locale = ['en', 'de', 'it', 'ja'].includes(String(req.query.locale)) ? String(req.query.locale) : 'en';
    const market = req.query.market && (MARKET_ORDER.includes(req.query.market) || req.query.market === '*') ? String(req.query.market) : '*';
    return adminPage(req, res, 'content-form', {
      title: `${PAGE_MANIFEST[pageKey].label} content`, active: 'content', pageKey,
      pageLabel: PAGE_MANIFEST[pageKey].label, locale, market,
      fields: contentEditorValues(db, pageKey, locale, market),
    });
  });

  router.post('/content/:pageKey', gate('content'), (req, res) => {
    const pageKey = String(req.params.pageKey);
    if (!PAGE_MANIFEST[pageKey]) return adminPage(req, res, 'error', { title: 'Content page not found', active: 'content', adminError: 'Content page not found.' }, 404);
    const locale = ['en', 'de', 'it', 'ja'].includes(String(req.body.locale)) ? String(req.body.locale) : 'en';
    const market = req.body.market && (MARKET_ORDER.includes(req.body.market) || req.body.market === '*') ? String(req.body.market) : '*';
    const values = {};
    PAGE_MANIFEST[pageKey].fields.forEach((field) => {
      values[field.key] = req.body[`field_${field.key}`];
    });
    try {
      saveContentFields(db, { pageKey, locale, market, values, userId: req.admin.user.id });
      audit(db, req.admin.user, 'content_updated', 'content', `${pageKey}:${locale}:${market}`, {});
      return res.redirect(303, `/admin/content/${pageKey}?locale=${locale}&market=${market}&saved=1`);
    } catch (error) {
      return adminPage(req, res, 'content-form', {
        title: `${PAGE_MANIFEST[pageKey].label} content`, active: 'content', pageKey,
        pageLabel: PAGE_MANIFEST[pageKey].label, locale, market,
        fields: contentEditorValues(db, pageKey, locale, market), adminError: error.message,
      }, 422);
    }
  });

  // FAQs ---------------------------------------------------------------------
  router.get('/faqs', gate('faqs'), (req, res) => {
    const faqs = db.prepare('SELECT * FROM faqs ORDER BY sort_order, id').all();
    const translations = {};
    db.prepare('SELECT * FROM faq_translations').all().forEach((row) => {
      if (!translations[row.faq_id]) translations[row.faq_id] = {};
      translations[row.faq_id][row.locale] = row;
    });
    return adminPage(req, res, 'faqs', { title: 'FAQs', active: 'faqs', faqs, translations });
  });

  router.post('/faqs/new', gate('faqs'), (req, res) => {
    try {
      const id = createFaq(db, req.body);
      updateFaq(db, id, req.body);
      audit(db, req.admin.user, 'faq_created', 'faq', id, {});
      return res.redirect(303, '/admin/faqs?saved=1');
    } catch (error) {
      return adminPage(req, res, 'error', { title: 'FAQ could not be created', active: 'faqs', adminError: error.message }, 422);
    }
  });

  router.post('/faqs/:id', gate('faqs'), (req, res) => {
    const id = Number(req.params.id);
    if (!getFaq(db, id)) return adminPage(req, res, 'error', { title: 'FAQ not found', active: 'faqs', adminError: 'FAQ not found.' }, 404);
    updateFaq(db, id, req.body);
    audit(db, req.admin.user, 'faq_updated', 'faq', id, {});
    return res.redirect(303, '/admin/faqs?saved=1');
  });

  // Case studies -------------------------------------------------------------
  router.get('/cases', gate('cases'), (req, res) => {
    const cases = db.prepare('SELECT * FROM case_studies ORDER BY updated_at DESC').all();
    return adminPage(req, res, 'cases', { title: 'Project cases', active: 'cases', cases });
  });

  router.post('/cases', gate('cases'), (req, res) => {
    const title = safeText(req.body.title, 200);
    const summary = safeText(req.body.summary, 4000);
    const slug = slugify(req.body.slug || title);
    const published = checkbox(req.body.published) ? 1 : 0;
    const authRef = safeText(req.body.authorization_reference, 300);
    const confirmed = checkbox(req.body.authorization_confirmed) ? 1 : 0;
    const verification = ['verified', 'company_published', 'pending'].includes(req.body.verification_status) ? req.body.verification_status : 'company_published';
    if (!title || !summary || !slug) return adminPage(req, res, 'cases', { title: 'Project cases', active: 'cases', cases: db.prepare('SELECT * FROM case_studies').all(), adminError: 'Title, summary and slug are required.' }, 422);
    if (published && verification === 'verified' && (!confirmed || !authRef)) return adminPage(req, res, 'cases', { title: 'Project cases', active: 'cases', cases: db.prepare('SELECT * FROM case_studies').all(), adminError: 'A verified reference cannot be published without an authorization reference and confirmation.' }, 422);
    const info = db.prepare(`
      INSERT INTO case_studies (
        slug, title, summary, summary_de, summary_it, market, location, project_type,
        products, year, image_path, source_url, verification_status,
        authorization_reference, authorization_confirmed, published, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, title, summary, safeText(req.body.summary_de, 4000), safeText(req.body.summary_it, 4000),
      safeText(req.body.market, 40) || null, safeText(req.body.location, 200) || null, safeText(req.body.project_type, 100) || null,
      safeText(req.body.products, 1000) || null, safeText(req.body.year, 20) || null,
      safeText(req.body.image_path, 300) || null, safeText(req.body.source_url, 500) || null, verification,
      authRef || null, confirmed, published, timestamp(), timestamp());
    audit(db, req.admin.user, 'case_created', 'case', Number(info.lastInsertRowid), { published });
    return res.redirect(303, '/admin/cases?saved=1');
  });

  router.get('/cases/:id', gate('cases'), (req, res) => {
    const entry = db.prepare('SELECT * FROM case_studies WHERE id = ?').get(Number(req.params.id));
    if (!entry) return adminPage(req, res, 'error', { title: 'Case not found', active: 'cases', adminError: 'Case not found.' }, 404);
    return adminPage(req, res, 'case-form', { title: 'Edit project case', active: 'cases', entry });
  });

  router.post('/cases/:id', gate('cases'), (req, res) => {
    const id = Number(req.params.id);
    const entry = db.prepare('SELECT * FROM case_studies WHERE id = ?').get(id);
    if (!entry) return adminPage(req, res, 'error', { title: 'Case not found', active: 'cases', adminError: 'Case not found.' }, 404);
    const title = safeText(req.body.title, 200);
    const summary = safeText(req.body.summary, 4000);
    const slug = slugify(req.body.slug || title);
    const published = checkbox(req.body.published) ? 1 : 0;
    const authRef = safeText(req.body.authorization_reference, 300);
    const confirmed = checkbox(req.body.authorization_confirmed) ? 1 : 0;
    const verification = ['verified', 'company_published', 'pending'].includes(req.body.verification_status) ? req.body.verification_status : (entry.verification_status || 'pending');
    if (!title || !summary || !slug) return adminPage(req, res, 'case-form', { title: 'Edit project case', active: 'cases', entry, adminError: 'Title, summary and slug are required.' }, 422);
    if (published && verification === 'verified' && (!confirmed || !authRef)) return adminPage(req, res, 'case-form', { title: 'Edit project case', active: 'cases', entry, adminError: 'A verified reference cannot be published without authorization.' }, 422);
    try {
      db.prepare(`
        UPDATE case_studies SET slug = ?, title = ?, summary = ?, summary_de = ?, summary_it = ?, market = ?,
          location = ?, project_type = ?, products = ?, year = ?, image_path = ?, source_url = ?, verification_status = ?,
          authorization_reference = ?, authorization_confirmed = ?, published = ?, updated_at = ? WHERE id = ?
      `).run(slug, title, summary, safeText(req.body.summary_de, 4000), safeText(req.body.summary_it, 4000),
        safeText(req.body.market, 40) || null, safeText(req.body.location, 200) || null, safeText(req.body.project_type, 100) || null,
        safeText(req.body.products, 1000) || null, safeText(req.body.year, 20) || null,
        safeText(req.body.image_path, 300) || null, safeText(req.body.source_url, 500) || null, verification,
        authRef || null, confirmed, published, timestamp(), id);
    } catch (error) {
      return adminPage(req, res, 'case-form', { title: 'Edit project case', active: 'cases', entry, adminError: 'The slug is already used by another case.' }, 422);
    }
    audit(db, req.admin.user, 'case_updated', 'case', id, { published });
    return res.redirect(303, `/admin/cases/${id}?saved=1`);
  });

  router.post('/cases/:id/toggle', gate('cases'), (req, res) => {
    const id = Number(req.params.id);
    const entry = db.prepare('SELECT * FROM case_studies WHERE id = ?').get(id);
    if (!entry) return adminPage(req, res, 'error', { title: 'Case not found', active: 'cases', adminError: 'Case not found.' }, 404);
    const next = entry.published ? 0 : 1;
    if (next && entry.verification_status !== 'company_published' && (!entry.authorization_confirmed || !entry.authorization_reference)) {
      return adminPage(req, res, 'cases', { title: 'Project cases', active: 'cases', cases: db.prepare('SELECT * FROM case_studies').all(), adminError: 'Authorization must be recorded before publishing a verified reference. Company-published references may be published with that status.' }, 422);
    }
    db.prepare('UPDATE case_studies SET published = ?, updated_at = ? WHERE id = ?').run(next, timestamp(), id);
    audit(db, req.admin.user, next ? 'case_published' : 'case_unpublished', 'case', id, {});
    return res.redirect(303, '/admin/cases?saved=1');
  });

  // News ---------------------------------------------------------------------
  router.get('/news', gate('content'), (req, res) => {
    const articles = db.prepare(`
      SELECT n.*, COALESCE(nt.title, nte.title) AS title,
        COALESCE(nt.excerpt, nte.excerpt) AS excerpt
      FROM news_articles n
      LEFT JOIN news_translations nt ON nt.article_id = n.id AND nt.locale = 'en'
      LEFT JOIN news_translations nte ON nte.article_id = n.id AND nte.locale = 'en'
      ORDER BY n.published_at DESC, n.sort_order
    `).all();
    return adminPage(req, res, 'news', { title: 'News', active: 'news', articles });
  });

  router.get('/news/:id', gate('content'), (req, res) => {
    const article = db.prepare('SELECT * FROM news_articles WHERE id = ?').get(Number(req.params.id));
    if (!article) return adminPage(req, res, 'error', { title: 'Article not found', active: 'news', adminError: 'Article not found.' }, 404);
    const translations = Object.fromEntries(db.prepare('SELECT * FROM news_translations WHERE article_id = ?').all(article.id).map((row) => [row.locale, row]));
    return adminPage(req, res, 'news-form', { title: `Edit ${article.slug}`, active: 'news', article, translations });
  });

  router.post('/news/:id', gate('content'), (req, res) => {
    const article = db.prepare('SELECT * FROM news_articles WHERE id = ?').get(Number(req.params.id));
    if (!article) return adminPage(req, res, 'error', { title: 'Article not found', active: 'news', adminError: 'Article not found.' }, 404);
    const category = req.body.category === 'industry' ? 'industry' : 'company';
    const publishedAt = safeText(req.body.published_at, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
      return adminPage(req, res, 'error', { title: 'Invalid article', active: 'news', adminError: 'Published date must use YYYY-MM-DD.' }, 422);
    }
    db.prepare(`
      UPDATE news_articles SET category = ?, published_at = ?, image_path = ?, source_url = ?,
        published = ?, updated_at = ? WHERE id = ?
    `).run(
      category, publishedAt, safeText(req.body.image_path, 300) || null,
      safeText(req.body.source_url, 500) || null, checkbox(req.body.published) ? 1 : 0,
      timestamp(), article.id,
    );
    for (const locale of ['en', 'de', 'it', 'ja']) {
      const title = safeText(req.body[`title_${locale}`], 300);
      if (!title) continue;
      db.prepare(`
        INSERT INTO news_translations (article_id, locale, title, excerpt, body, seo_title, seo_description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(article_id, locale) DO UPDATE SET
          title = excluded.title, excerpt = excluded.excerpt, body = excluded.body,
          seo_title = excluded.seo_title, seo_description = excluded.seo_description
      `).run(
        article.id, locale, title, safeText(req.body[`excerpt_${locale}`], 1000),
        safeText(req.body[`body_${locale}`], 12000), safeText(req.body[`seo_title_${locale}`], 200),
        safeText(req.body[`seo_description_${locale}`], 320),
      );
    }
    audit(db, req.admin.user, 'news_updated', 'news_article', article.id, { category });
    return res.redirect(303, `/admin/news/${article.id}?saved=1`);
  });

  // Documents ----------------------------------------------------------------
  router.get('/documents', gate('documents'), (req, res) => {
    const documents = listDocuments(db, { includeInternal: true, locale: 'en' });
    return adminPage(req, res, 'documents', {
      title: 'Documents', active: 'documents', documents,
      products: productOptions(db), docTypes: DOC_TYPES, documentTypeLabel,
    });
  });

  router.get('/documents/new', gate('documents'), (req, res) => {
    return adminPage(req, res, 'document-form', {
      title: 'New document', active: 'documents', document: null,
      products: productOptions(db), categories: categoryOptions(db), docTypes: DOC_TYPES,
      markets: MARKETS, visibilities: VISIBILITIES, statuses: DOC_STATUSES, selectedMarkets: ['global'],
    });
  });

  router.get('/documents/:id', gate('documents'), (req, res) => {
    const document = getDocumentById(db, Number(req.params.id));
    if (!document) return adminPage(req, res, 'error', { title: 'Document not found', active: 'documents', adminError: 'Document not found.' }, 404);
    return adminPage(req, res, 'document-form', {
      title: `${document.title} · Edit document`, active: 'documents', document,
      products: productOptions(db), categories: categoryOptions(db), docTypes: DOC_TYPES,
      markets: MARKETS, visibilities: VISIBILITIES, statuses: DOC_STATUSES, selectedMarkets: document.markets,
    });
  });

  function saveDocument(req, res, existing) {
    try {
      const title = safeText(req.body.title, 300);
      const docType = DOC_TYPES.includes(req.body.doc_type) ? req.body.doc_type : 'spec_sheet';
      const visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : 'request';
      let status = DOC_STATUSES.includes(req.body.status) ? req.body.status : 'pending';
      const markets = parseMarkets(req.body.markets);
      const version = safeText(req.body.version, 80) || 'Not published';
      if (!title) throw new Error('Title is required.');
      if (!markets.length) throw new Error('Select at least one market.');
      let fileFields = {};
      if (req.file) {
        const inspected = inspectFiles([req.file]);
        const stored = storeFiles(inspected)[0];
        fileFields = {
          file_path: stored.stored_name,
          original_name: stored.original_name,
          mime_type: stored.mime_type,
          size_bytes: stored.size_bytes,
          sha256: stored.sha256,
        };
      }
      if (status === 'available' && !req.file && !(existing && existing.file_path)) {
        status = visibility === 'public' ? 'request_only' : 'pending';
      }
      if (visibility === 'public' && status === 'available' && !fileFields.file_path && !(existing && existing.file_path)) {
        throw new Error('A public download cannot be marked available without a file.');
      }
      const productId = req.body.product_id ? Number(req.body.product_id) : null;
      const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
      const supersedesId = req.body.supersedes_id ? Number(req.body.supersedes_id) : null;
      const lang = ['en', 'de', 'it', 'ja'].includes(req.body.language) ? req.body.language : 'en';
      if (existing) {
        db.prepare(`
          UPDATE documents SET title = ?, doc_type = ?, product_id = ?, category_id = ?, version = ?, language = ?,
            markets = ?, visibility = ?, status = ?, effective_date = ?, notes = ?, supersedes_id = ?,
            file_path = COALESCE(?, file_path), original_name = COALESCE(?, original_name),
            mime_type = COALESCE(?, mime_type), size_bytes = COALESCE(?, size_bytes), sha256 = COALESCE(?, sha256),
            updated_at = ? WHERE id = ?
        `).run(title, docType, productId, categoryId, version, lang, JSON.stringify(markets), visibility, status,
          safeText(req.body.effective_date, 20) || null, safeText(req.body.notes, 3000) || null, supersedesId,
          fileFields.file_path || null, fileFields.original_name || null, fileFields.mime_type || null, fileFields.size_bytes || null, fileFields.sha256 || null,
          timestamp(), existing.id);
      } else {
        const info = db.prepare(`
          INSERT INTO documents (title, doc_type, product_id, category_id, version, language, markets, visibility, status,
            file_path, original_name, mime_type, size_bytes, sha256, effective_date, notes, supersedes_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(title, docType, productId, categoryId, version, lang, JSON.stringify(markets), visibility, status,
          fileFields.file_path || null, fileFields.original_name || null, fileFields.mime_type || null, fileFields.size_bytes || null,
          fileFields.sha256 || null, safeText(req.body.effective_date, 20) || null, safeText(req.body.notes, 3000) || null,
          supersedesId, timestamp(), timestamp());
        existing = { id: Number(info.lastInsertRowid) };
      }
      audit(db, req.admin.user, existing.id ? 'document_saved' : 'document_created', 'document', existing.id, { title, visibility, status });
      return res.redirect(303, `/admin/documents/${existing.id}?saved=1`);
    } catch (error) {
      return adminPage(req, res, 'document-form', {
        title: existing ? 'Edit document' : 'New document', active: 'documents', document: existing || null,
        products: productOptions(db), categories: categoryOptions(db), docTypes: DOC_TYPES,
        markets: MARKETS, visibilities: VISIBILITIES, statuses: DOC_STATUSES,
        selectedMarkets: parseMarkets(req.body.markets), adminError: error.message,
      }, 422);
    }
  }

  router.post('/documents/new', gate('documents'), adminUploadCsrf(DOC_UPLOAD), (req, res) => saveDocument(req, res, null));
  router.post('/documents/:id', gate('documents'), adminUploadCsrf(DOC_UPLOAD), (req, res) => {
    const existing = getDocumentById(db, Number(req.params.id));
    if (!existing) return adminPage(req, res, 'error', { title: 'Document not found', active: 'documents', adminError: 'Document not found.' }, 404);
    return saveDocument(req, res, existing);
  });

  router.get('/documents/:id/file', gate('documents'), (req, res) => {
    const document = getDocumentById(db, Number(req.params.id));
    if (!document) return res.status(404).send('Document not found.');
    const file = resolveStoredFile(document.file_path);
    if (!file) return res.status(404).send('File not available.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${String(document.original_name || 'document').replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(file).pipe(res);
  });

  router.post('/documents/:id/withdraw', gate('documents'), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run('withdrawn', timestamp(), id);
    audit(db, req.admin.user, 'document_withdrawn', 'document', id, {});
    return res.redirect(303, `/admin/documents/${id}?saved=1`);
  });

  // Customization requests ---------------------------------------------------
  router.get('/customization', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const filters = {
      q: safeText(req.query.q, 120),
      market: MARKET_ORDER.includes(String(req.query.market)) ? String(req.query.market) : '',
      customer_type: CUSTOMER_TYPES.includes(String(req.query.customer_type)) ? String(req.query.customer_type) : '',
      status: safeText(req.query.status, 20),
      page: safeQueryInteger(req.query.page, 1),
    };
    const result = listCustomizations(db, filters);
    return adminPage(req, res, 'customization', {
      title: 'Customization requests', active: 'customization', result, filters,
      customerTypes: CUSTOMER_TYPES,
    });
  });

  router.get('/customization/export.csv', (req, res) => {
    if (!['super_admin', 'sales_manager'].includes(req.admin.user.role)) return res.status(403).send('Forbidden');
    const rows = exportCustomizations(db);
    const columns = [
      { label: 'reference', value: (row) => row.reference },
      { label: 'created_at', value: (row) => row.created_at },
      { label: 'market', value: (row) => row.market },
      { label: 'locale', value: (row) => row.locale },
      { label: 'customer_type', value: (row) => row.customer_type },
      { label: 'request_type', value: (row) => row.request_type },
      { label: 'name', value: (row) => row.contact_name },
      { label: 'company', value: (row) => row.company || '' },
      { label: 'email', value: (row) => row.email },
      { label: 'phone', value: (row) => row.phone || '' },
      { label: 'country', value: (row) => row.country },
      { label: 'products', value: (row) => row.products_json },
      { label: 'customizations', value: (row) => row.customizations_json },
      { label: 'buyer_context', value: (row) => row.buyer_context_json },
      { label: 'message', value: (row) => row.message || '' },
      { label: 'status', value: (row) => row.status },
      { label: 'internal_note', value: (row) => row.internal_note || '' },
    ];
    audit(db, req.admin.user, 'customizations_exported', 'customization_request', null, { count: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="olang-customization-requests.csv"');
    return res.send(buildCsv(rows, columns));
  });

  router.get('/customization/file/:fileId', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return res.status(403).send('Forbidden');
    const file = db.prepare(`
      SELECT f.*, r.reference FROM customization_files f
      JOIN customization_requests r ON r.id = f.request_id WHERE f.id = ?
    `).get(Number(req.params.fileId));
    const absolute = file ? resolveStoredFile(file.stored_name) : null;
    if (!file || !absolute) return res.status(404).send('File not found.');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(file.original_name).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(absolute).pipe(res);
  });

  router.get('/customization/:id', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const request = getCustomizationById(db, Number(req.params.id));
    if (!request) return adminPage(req, res, 'error', { title: 'Request not found', active: 'customization', adminError: 'Customization request not found.' }, 404);
    return adminPage(req, res, 'customization-detail', {
      title: request.reference, active: 'customization', request,
      canManage: managerAccess(req.admin.user),
    });
  });

  router.post('/customization/:id/status', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const request = getCustomizationById(db, Number(req.params.id));
    if (!request) return adminPage(req, res, 'error', { title: 'Request not found', active: 'customization', adminError: 'Customization request not found.' }, 404);
    const status = ['new', 'review', 'quoted', 'closed', 'archived'].includes(req.body.status) ? req.body.status : request.status;
    updateCustomizationStatus(db, request.id, status, safeText(req.body.internal_note, 4000));
    audit(db, req.admin.user, 'customization_status_updated', 'customization_request', request.id, { status });
    return res.redirect(303, `/admin/customization/${request.id}?saved=1`);
  });

  // Inquiries ----------------------------------------------------------------
  router.get('/inquiries', (req, res, next) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const filters = {
      status: STATUSES.includes(String(req.query.status)) ? String(req.query.status) : '',
      type: INQUIRY_TYPES.includes(String(req.query.type)) ? String(req.query.type) : '',
      market: MARKET_ORDER.includes(String(req.query.market)) ? String(req.query.market) : '',
      country: safeText(req.query.country, 120),
      q: safeText(req.query.q, 120),
      from: safeText(req.query.from, 20),
      to: safeText(req.query.to, 20),
      page: Math.max(1, safeQueryInteger(req.query.page, 1)),
      limit: 25,
    };
    if (!managerAccess(req.admin.user)) filters.assignedTo = req.admin.user.id;
    const result = listInquiries(db, filters);
    return adminPage(req, res, 'inquiries', {
      title: 'Inquiries', active: 'inquiries', result, filters,
      statuses: STATUSES, types: INQUIRY_TYPES, markets: MARKET_ORDER,
    });
  });

  router.get('/inquiries/export.csv', (req, res, next) => {
    if (!['super_admin', 'sales_manager'].includes(req.admin.user.role)) return res.status(403).send('Forbidden');
    const filters = {
      status: STATUSES.includes(String(req.query.status)) ? String(req.query.status) : '',
      type: INQUIRY_TYPES.includes(String(req.query.type)) ? String(req.query.type) : '',
      market: MARKET_ORDER.includes(String(req.query.market)) ? String(req.query.market) : '',
      country: safeText(req.query.country, 120),
      q: safeText(req.query.q, 120),
      from: safeText(req.query.from, 20),
      to: safeText(req.query.to, 20),
      all: true,
    };
    const result = listInquiries(db, filters);
    const itemsStmt = db.prepare('SELECT sku, product_name, quantity, notes FROM inquiry_items WHERE inquiry_id = ? ORDER BY sort_order');
    const fieldsStmt = db.prepare('SELECT field_key, value FROM inquiry_fields WHERE inquiry_id = ? ORDER BY field_key');
    const attachmentsStmt = db.prepare('SELECT original_name, size_bytes FROM inquiry_attachments WHERE inquiry_id = ? ORDER BY id');
    const rows = result.rows.map((row) => {
      const items = itemsStmt.all(row.id);
      const fields = Object.fromEntries(fieldsStmt.all(row.id).map((entry) => [entry.field_key, entry.value]));
      const attachments = attachmentsStmt.all(row.id);
      return {
        ...row,
        item_lines: items.map((item) => `${item.sku} × ${item.quantity}${item.notes ? ` (${item.notes})` : ''}`).join(' | '),
        item_quantity_total: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        item_details: items.map((item) => `${item.sku}: ${item.quantity}`).join('; '),
        field_target_market: fields.target_market || '',
        field_finish: fields.requested_finish || fields.required_finish || fields.oem_finish || '',
        field_project: fields.project_name || '',
        field_terms: fields.terms || '',
        field_packaging: fields.packaging || '',
        field_delivery: fields.delivery_schedule || '',
        attachment_names: attachments.map((file) => file.original_name).join(' | '),
      };
    });
    const columns = [
      { label: 'reference', value: (r) => r.reference }, { label: 'created_at', value: (r) => r.created_at },
      { label: 'type', value: (r) => r.type }, { label: 'status', value: (r) => statusLabel(r.status) },
      { label: 'name', value: (r) => r.name }, { label: 'company', value: (r) => r.company || '' },
      { label: 'email', value: (r) => r.email }, { label: 'phone', value: (r) => r.phone || '' },
      { label: 'country', value: (r) => r.country }, { label: 'market', value: (r) => r.market },
      { label: 'locale', value: (r) => r.locale }, { label: 'source_path', value: (r) => r.source_path || '' },
      { label: 'model_lines', value: (r) => r.item_lines }, { label: 'quantity_total', value: (r) => r.item_quantity_total },
      { label: 'target_market', value: (r) => r.field_target_market },
      { label: 'finish', value: (r) => r.field_finish }, { label: 'project', value: (r) => r.field_project },
      { label: 'terms', value: (r) => r.field_terms }, { label: 'packaging', value: (r) => r.field_packaging },
      { label: 'delivery', value: (r) => r.field_delivery }, { label: 'attachments', value: (r) => r.attachment_names },
      { label: 'message', value: (r) => r.message },
    ];
    audit(db, req.admin.user, 'inquiries_exported', 'inquiry', null, { count: rows.length, filters });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="olang-inquiries.csv"');
    return res.send(buildCsv(rows, columns));
  });

  function canAccessInquiry(req, inquiry) {
    if (!inquiry) return false;
    if (managerAccess(req.admin.user)) return true;
    return Number(inquiry.assigned_to) === Number(req.admin.user.id);
  }

  router.get('/inquiries/:id', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const inquiry = getInquiryDetail(db, Number(req.params.id));
    if (!inquiry) return adminPage(req, res, 'error', { title: 'Inquiry not found', active: 'inquiries', adminError: 'Inquiry not found.' }, 404);
    if (!canAccessInquiry(req, inquiry)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: 'inquiries' }, 403);
    return adminPage(req, res, 'inquiry', {
      title: inquiry.reference, active: 'inquiries', inquiry,
      statuses: STATUSES, types: INQUIRY_TYPES, assignees: adminUsers(db),
      canAssign: managerAccess(req.admin.user),
      canUpdateStatus: managerAccess(req.admin.user) || (req.admin.user.role === 'sales_staff' && Number(inquiry.assigned_to) === Number(req.admin.user.id)),
      canErase: isSuper(req.admin.user),
      statusLabel,
    });
  });

  router.post('/inquiries/:id/status', (req, res) => {
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(req.params.id));
    if (!inquiry) return adminPage(req, res, 'error', { title: 'Inquiry not found', active: 'inquiries', adminError: 'Inquiry not found.' }, 404);
    const canManage = managerAccess(req.admin.user);
    const canUpdate = canManage || (req.admin.user.role === 'sales_staff' && Number(inquiry.assigned_to) === Number(req.admin.user.id));
    if (!canUpdate) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const status = STATUSES.includes(req.body.status) ? req.body.status : inquiry.status;
    const assignedTo = canManage
      ? (req.body.assigned_to ? Number(req.body.assigned_to) : null)
      : inquiry.assigned_to;
    if (assignedTo && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(assignedTo)) {
      return adminPage(req, res, 'error', { title: 'Invalid assignee', active: 'inquiries', adminError: 'The selected assignee is not an active user.' }, 422);
    }
    const changes = [];
    if (status !== inquiry.status) {
      changes.push(['status', inquiry.status, status]);
      db.prepare('UPDATE inquiries SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?')
        .run(status, timestamp(), ['won', 'lost', 'archived'].includes(status) ? timestamp() : null, inquiry.id);
    }
    if (assignedTo !== inquiry.assigned_to) {
      changes.push(['assigned_to', inquiry.assigned_to, assignedTo]);
      db.prepare('UPDATE inquiries SET assigned_to = ?, updated_at = ? WHERE id = ?').run(assignedTo, timestamp(), inquiry.id);
    }
    for (const [field, from, to] of changes) {
      db.prepare(`
        INSERT INTO inquiry_events (inquiry_id, user_id, event_type, from_value, to_value, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).run(inquiry.id, req.admin.user.id, field === 'status' ? 'status_changed' : 'assigned', from == null ? null : String(from), to == null ? null : String(to), timestamp());
    }
    audit(db, req.admin.user, 'inquiry_updated', 'inquiry', inquiry.id, { changes });
    return res.redirect(303, `/admin/inquiries/${inquiry.id}?saved=1`);
  });

  router.post('/inquiries/:id/note', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const inquiry = getInquiryDetail(db, Number(req.params.id));
    if (!inquiry || !canAccessInquiry(req, inquiry)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const note = safeText(req.body.note, 5000);
    if (!note) return res.redirect(303, `/admin/inquiries/${inquiry.id}?error=Note+is+required`);
    db.prepare('INSERT INTO inquiry_notes (inquiry_id, user_id, note, created_at) VALUES (?, ?, ?, ?)')
      .run(inquiry.id, req.admin.user.id, note, timestamp());
    db.prepare('INSERT INTO inquiry_events (inquiry_id, user_id, event_type, from_value, to_value, meta_json, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?)')
      .run(inquiry.id, req.admin.user.id, 'note_added', timestamp());
    audit(db, req.admin.user, 'inquiry_note_added', 'inquiry', inquiry.id, {});
    return res.redirect(303, `/admin/inquiries/${inquiry.id}?saved=1`);
  });

  router.get('/attachments/:id', (req, res) => {
    if (!inquiryAccess(req.admin.user)) return res.status(403).send('Forbidden');
    const attachment = db.prepare('SELECT * FROM inquiry_attachments WHERE id = ?').get(Number(req.params.id));
    if (!attachment) return res.status(404).send('Attachment not found.');
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(attachment.inquiry_id);
    if (!inquiry || !canAccessInquiry(req, inquiry)) return res.status(403).send('Forbidden');
    const file = resolveStoredFile(attachment.stored_name);
    if (!file) return res.status(404).send('File not found.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${String(attachment.original_name).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(file).pipe(res);
  });

  router.post('/inquiries/:id/erase', (req, res) => {
    if (!isSuper(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const inquiry = getInquiryDetail(db, Number(req.params.id));
    if (!inquiry) return adminPage(req, res, 'error', { title: 'Inquiry not found', active: 'inquiries', adminError: 'Inquiry not found.' }, 404);
    if (String(req.body.confirm || '') !== inquiry.reference) {
      return adminPage(req, res, 'inquiry', {
        title: inquiry.reference, active: 'inquiries', inquiry, statuses: STATUSES, types: INQUIRY_TYPES,
        assignees: adminUsers(db), canAssign: true, canUpdateStatus: true, canErase: true, statusLabel,
        adminError: `Type the reference (${inquiry.reference}) exactly to erase this inquiry and its attachments.`,
      }, 422);
    }
    for (const attachment of inquiry.attachments) {
      const file = resolveStoredFile(attachment.stored_name);
      if (file) { try { fs.unlinkSync(file); } catch (_) {} }
    }
    const reference = inquiry.reference;
    db.prepare('DELETE FROM inquiries WHERE id = ?').run(inquiry.id);
    audit(db, req.admin.user, 'inquiry_erased', 'inquiry', inquiry.id, { reference });
    return res.redirect(303, '/admin/inquiries?saved=1');
  });

  // Privacy requests ---------------------------------------------------------
  router.get('/privacy-requests', (req, res) => {
    if (!managerAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const rows = db.prepare('SELECT * FROM privacy_requests ORDER BY created_at DESC LIMIT 200').all();
    return adminPage(req, res, 'privacy-requests', { title: 'Privacy requests', active: 'privacy-requests', rows });
  });

  router.post('/privacy-requests/:id', (req, res) => {
    if (!managerAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const id = Number(req.params.id);
    const status = ['new', 'verifying', 'completed', 'rejected'].includes(req.body.status) ? req.body.status : 'new';
    const update = db.prepare('UPDATE privacy_requests SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, status === 'completed' ? timestamp() : null, id);
    if (!update.changes) return adminPage(req, res, 'error', { title: 'Privacy request not found', active: 'privacy-requests', adminError: 'Privacy request not found.' }, 404);
    audit(db, req.admin.user, 'privacy_request_updated', 'privacy_request', id, { status });
    return res.redirect(303, '/admin/privacy-requests?saved=1');
  });

  // Outbox -------------------------------------------------------------------
  router.get('/outbox', (req, res) => {
    if (!managerAccess(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const rows = db.prepare(`
      SELECT o.*, i.reference FROM email_outbox o
      LEFT JOIN inquiries i ON i.id = o.inquiry_id
      ORDER BY o.created_at DESC LIMIT 100
    `).all();
    return adminPage(req, res, 'outbox', { title: 'Email outbox', active: 'outbox', rows });
  });

  // Users --------------------------------------------------------------------
  router.get('/users', (req, res) => {
    if (!isSuper(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const users = db.prepare('SELECT id, username, display_name, email, role, active, last_login_at, created_at FROM users ORDER BY created_at').all();
    return adminPage(req, res, 'users', { title: 'Users', active: 'users', users, roles: ROLE_OPTIONS });
  });

  router.post('/users', (req, res) => {
    if (!isSuper(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const username = safeText(req.body.username, 80);
    const displayName = safeText(req.body.display_name, 120);
    const email = normalizeEmail(req.body.email);
    const role = ROLE_OPTIONS.some(([key]) => key === req.body.role) ? req.body.role : 'sales_staff';
    const password = String(req.body.password || '');
    const problems = passwordProblems(password, username);
    if (!username || !displayName) problems.push('Username and display name are required.');
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) problems.push('Username must contain 3–80 letters, numbers, dots, underscores or hyphens.');
    if (problems.length) {
      return adminPage(req, res, 'users', {
        title: 'Users', active: 'users', users: db.prepare('SELECT id, username, display_name, email, role, active, last_login_at, created_at FROM users ORDER BY created_at').all(),
        roles: ROLE_OPTIONS, adminError: problems.join(' '),
      }, 422);
    }
    try {
      const info = db.prepare(`
        INSERT INTO users (username, email, display_name, password_hash, role, active, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(username, email || null, displayName, hashPassword(password), role, timestamp(), timestamp());
      audit(db, req.admin.user, 'user_created', 'user', Number(info.lastInsertRowid), { username, role });
      return res.redirect(303, '/admin/users?saved=1');
    } catch (error) {
      return adminPage(req, res, 'users', {
        title: 'Users', active: 'users', roles: ROLE_OPTIONS,
        users: db.prepare('SELECT id, username, display_name, email, role, active, last_login_at, created_at FROM users ORDER BY created_at').all(),
        adminError: 'That username is already in use.',
      }, 422);
    }
  });

  router.post('/users/:id', (req, res) => {
    if (!isSuper(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return adminPage(req, res, 'error', { title: 'User not found', active: 'users', adminError: 'User not found.' }, 404);
    const role = ROLE_OPTIONS.some(([key]) => key === req.body.role) ? req.body.role : user.role;
    const active = checkbox(req.body.active) ? 1 : 0;
    const displayName = safeText(req.body.display_name, 120) || user.display_name;
    const email = normalizeEmail(req.body.email);
    if (id === req.admin.user.id && (!active || role !== user.role)) {
      return adminPage(req, res, 'error', { title: 'Cannot update own access', active: 'users', adminError: 'You cannot deactivate yourself or change your own role.' }, 422);
    }
    if (user.role === 'super_admin' && (role !== 'super_admin' || !active)) {
      const otherSupers = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin' AND active = 1 AND id <> ?").get(id).c;
      if (!otherSupers) return adminPage(req, res, 'error', { title: 'Last super admin', active: 'users', adminError: 'At least one active super admin is required.' }, 422);
    }
    db.prepare('UPDATE users SET display_name = ?, email = ?, role = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(displayName, email || null, role, active, timestamp(), id);
    if (!active) deleteUserSessions(db, id);
    const newPassword = String(req.body.new_password || '');
    if (newPassword) {
      const problems = passwordProblems(newPassword, user.username);
      if (problems.length) return adminPage(req, res, 'error', { title: 'Password rejected', active: 'users', adminError: problems.join(' ') }, 422);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
        .run(hashPassword(newPassword), timestamp(), id);
      deleteUserSessions(db, id);
    }
    audit(db, req.admin.user, 'user_updated', 'user', id, { role, active });
    return res.redirect(303, '/admin/users?saved=1');
  });

  // Audit log ----------------------------------------------------------------
  router.get('/audit', (req, res) => {
    if (!isSuper(req.admin.user)) return adminPage(req, res, 'forbidden', { title: 'Access denied', active: '' }, 403);
    return adminPage(req, res, 'audit', { title: 'Audit log', active: 'audit', rows: listAudit(db, 300) });
  });

  // No match inside admin ----------------------------------------------------
  router.use((req, res) => adminPage(req, res, 'error', {
    title: 'Not found', active: '', adminError: 'The requested admin page does not exist.',
  }, 404));

  return router;
};

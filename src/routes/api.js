'use strict';

const express = require('express');
const multer = require('multer');
const config = require('../config');
const { publicContext, verifyPublicCsrf, verifyFormStamp } = require('../middleware/public-context');
const { getMarket } = require('../i18n/markets');
const { makeTranslator } = require('../i18n');
const { requestMeta, isSameOrigin } = require('../lib/request');
const { getSetting } = require('../services/settings');
const { AppError, ValidationError } = require('../lib/app-error');
const { createInquiry, createPrivacyRequest } = require('../services/inquiries');
const { createCustomizationRequest } = require('../services/customization');
const { saveConsent } = require('../services/consent');
const { recordEvent } = require('../services/analytics');
const { askWithOptionalLlm } = require('../services/assistant');
const { listProducts, getProductBySku } = require('../services/products');
const { consume } = require('../services/rate-limit');
const { appendCookie, serializeCookie } = require('../lib/cookies');
const { nowIso } = require('../lib/util');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxBytes,
    files: config.uploads.maxFiles,
    fields: 1200,
    parts: 1210,
    fieldSize: 20 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!String(file.originalname || '').trim()) return callback(null, false);
    return callback(null, true);
  },
});

function apiContext(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  return publicContext(req.app.locals.db)(req, res, next);
}

function acceptsJson(req) {
  return (req.headers.accept || '').includes('application/json') || req.headers['x-requested-with'] === 'fetch';
}

function localeFromRequest(req) {
  const bodyMarket = req.body && req.body.market;
  if (bodyMarket) {
    const market = getMarket(bodyMarket);
    if (market && market.code === bodyMarket) return market.locale;
  }
  const queryMarket = req.query && req.query.market;
  if (queryMarket) return getMarket(queryMarket).locale;
  return 'en';
}

function messageFor(req, code) {
  const t = makeTranslator(localeFromRequest(req));
  const value = t(`forms.errors.${code}`);
  return value && value !== `forms.errors.${code}` ? value : t('forms.errors.unknown');
}

function safeReturnPath(value, fallback = '/en/contact') {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  return path.slice(0, 300);
}

function errorResponse(req, res, error) {
  const status = error.status || 500;
  const code = error.code || 'unknown';
  if (status >= 500) console.error('[api]', error);
  if (acceptsJson(req)) {
    return res.status(status).json({ ok: false, error: code, message: messageFor(req, code) });
  }
  if (req.body && req.body.return_to) {
    const target = safeReturnPath(req.body.return_to, '/en/contact');
    const separator = target.includes('?') ? '&' : '?';
    return res.redirect(303, `${target}${separator}form_error=${encodeURIComponent(code)}#inquiry-form`);
  }
  return res.status(status).type('text/plain').send(messageFor(req, code));
}

function multerHandler(req, res, next) {
  upload.array('attachments', config.uploads.maxFiles)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const code = error.code === 'LIMIT_FILE_SIZE' ? 'file_size'
        : (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') ? 'file_count'
          : (error.code === 'LIMIT_FIELD_COUNT' || error.code === 'LIMIT_FIELD_VALUE' || error.code === 'LIMIT_FIELD_KEY' || error.code === 'LIMIT_PART_COUNT') ? 'form_fields'
            : 'file_failed';
      return errorResponse(req, res, new AppError(error.message, { status: 422, code }));
    }
    return next(error);
  });
}

function csrfGate(req, res, next) {
  if (!isSameOrigin(req)) return next(new AppError('Cross-origin request rejected.', { status: 403, code: 'csrf' }));
  if (!verifyPublicCsrf(req)) {
    return next(new AppError('Security token expired.', { status: 403, code: 'csrf' }));
  }
  const stamp = verifyFormStamp(
    req.body && req.body.form_stamp,
    req.visitorId,
    req.app.locals.formSalt,
  );
  if (!stamp.ok) {
    if (stamp.reason === 'too_fast') return next(new ValidationError('bot'));
    return next(new AppError('Security token expired. Refresh the page and try again.', { status: 403, code: 'csrf' }));
  }
  next();
}

// GET catalogue data for the browser-side comparison and inquiry list widgets.
router.get('/products', apiContext, (req, res) => {
  const market = getMarket(String(req.query.market || 'en'));
  const products = listProducts(req.app.locals.db, { locale: market.locale });
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.json({
    ok: true,
    market: market.code,
    products: products.map((product) => ({
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      category: product.category_name,
      series: product.series,
      image: product.image_path ? `/${product.image_path.replace(/^\/+/, '')}` : '/assets/placeholder.svg',
      shortDescription: product.short_description,
      url: `/${market.prefix}/products/${product.slug}`,
      finishes: product.finishes.map((finish) => ({ code: finish.code, name: finish.name, status: finish.status })),
      attributes: Object.fromEntries(Object.entries(product.attrMap)
        .filter(([, attr]) => Number(attr.visible_frontend) !== 0)
        .map(([key, attr]) => [key, {
          value: attr.value, unit: attr.unit,
          status: (attr.data_source === 'illustrative' || attr.data_source === 'reference_assumption') ? 'reference' : attr.status,
        }])),
    })),
  });
});

router.get('/products/:sku', apiContext, (req, res) => {
  const market = getMarket(String(req.query.market || 'en'));
  const product = getProductBySku(req.app.locals.db, String(req.params.sku).toUpperCase(), market.locale);
  if (!product) return res.status(404).json({ ok: false, error: 'not_found' });
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.json({
    ok: true,
    product: {
      sku: product.sku,
      name: product.name,
      category: product.category_name,
      series: product.series,
      image: product.image_path ? `/${product.image_path.replace(/^\/+/, '')}` : '/assets/placeholder.svg',
      shortDescription: product.short_description,
      description: product.description,
      url: `/${market.prefix}/products/${product.slug}`,
      finishes: product.finishes.map((finish) => ({ code: finish.code, name: finish.name, status: finish.status })),
      attributes: Object.fromEntries(Object.entries(product.attrMap)
        .filter(([, attr]) => Number(attr.visible_frontend) !== 0)
        .map(([key, attr]) => [key, {
          value: attr.value, unit: attr.unit,
          status: (attr.data_source === 'illustrative' || attr.data_source === 'reference_assumption') ? 'reference' : attr.status,
        }])),
    },
  });
});

router.post('/inquiries', apiContext, multerHandler, csrfGate, (req, res) => {
  try {
    const salt = getSetting(req.app.locals.db, 'security.ip_hash_salt', '');
    req.formSalt = salt;
    const meta = requestMeta(req, salt);
    const result = createInquiry(req.app.locals.db, req.body, meta, req.files || []);
    const prefix = getMarket(result.inquiry.market).prefix;
    const redirect = `/${prefix}/success?ref=${encodeURIComponent(result.inquiry.reference)}`;
    if (acceptsJson(req)) {
      return res.status(201).json({
        ok: true,
        reference: result.inquiry.reference,
        type: result.inquiry.type,
        redirect,
        email: result.email,
      });
    }
    return res.redirect(303, redirect);
  } catch (error) {
    return errorResponse(req, res, error);
  }
});

router.post('/customization', apiContext, multerHandler, csrfGate, (req, res) => {
  try {
    const result = createCustomizationRequest(req.app.locals.db, req.body, req.files || []);
    const market = getMarket(result.request.market);
    const redirect = `/${market.prefix}/customization/success?ref=${encodeURIComponent(result.request.reference)}`;
    if (acceptsJson(req)) {
      return res.status(201).json({
        ok: true,
        reference: result.request.reference,
        redirect,
        storedFiles: result.files,
        delivery: 'demo_local_only',
      });
    }
    return res.redirect(303, redirect);
  } catch (error) {
    return errorResponse(req, res, error);
  }
});

router.post('/consent', apiContext, (req, res) => {
  try {
    if (!isSameOrigin(req)) throw new AppError('Cross-origin request rejected.', { status: 403, code: 'csrf' });
    if (!verifyPublicCsrf(req)) throw new AppError('Security token expired.', { status: 403, code: 'csrf' });
    const analytics = /^(1|true|yes|on)$/i.test(String(req.body.analytics || ''));
    saveConsent(req.app.locals.db, req.visitorId, analytics);
    appendCookie(res, serializeCookie('olang_consent', analytics ? '1' : '0', {
      secure: config.sessionCookieSecure, sameSite: 'Lax', httpOnly: false, path: '/', maxAge: 180 * 24 * 3600,
    }));
    if (acceptsJson(req)) {
      return res.json({ ok: true, analytics });
    }
    const target = safeReturnPath(req.body.return_to, '/en/privacy');
    return res.redirect(303, `${target.split('#')[0]}#cookies`);
  } catch (error) {
    return errorResponse(req, res, error);
  }
});

router.post('/events', apiContext, (req, res) => {
  try {
    if (!isSameOrigin(req)) return res.status(204).end();
    if (!req.body || typeof req.body !== 'object') return res.status(204).end();
    const salt = getSetting(req.app.locals.db, 'security.ip_hash_salt', '');
    const meta = requestMeta(req, salt);
    const limit = consume(req.app.locals.db, `event:${req.visitorId}`, 300, 60);
    if (!limit.allowed) return res.status(204).end();
    if (req.analyticsConsent) {
      recordEvent(req.app.locals.db, req.body, {
        visitorId: req.visitorId, device: meta.device, country: meta.country,
      });
    }
    return res.status(204).end();
  } catch (error) {
    console.error('[analytics]', error.message);
    return res.status(204).end();
  }
});

router.post('/assistant', apiContext, async (req, res) => {
  try {
    if (!isSameOrigin(req)) throw new AppError('Cross-origin request rejected.', { status: 403, code: 'csrf' });
    const meta = requestMeta(req, getSetting(req.app.locals.db, 'security.ip_hash_salt', ''));
    const limit = consume(req.app.locals.db, `assistant:${req.visitorId}:${meta.ipHash}`, 30, 60);
    if (!limit.allowed) return res.status(429).json({ ok: false, error: 'rate' });
    const market = getMarket(String(req.body.market || 'en'));
    const question = String(req.body.question || '').slice(0, 400);
    if (question.trim().length < 2) return res.status(400).json({ ok: false, error: 'empty' });
    const result = await askWithOptionalLlm(req.app.locals.db, { question, market: market.code, locale: market.locale });
    return res.json({
      ok: true,
      ...result,
      matched_type: result.matchedType || null,
      matched_ref: result.matchedRef || null,
      generatedAt: nowIso(),
    });
  } catch (error) {
    console.error('[assistant]', error);
    return res.status(500).json({ ok: false, error: 'error' });
  }
});

router.post('/privacy-request', apiContext, multerHandler, csrfGate, (req, res) => {
  try {
    const salt = getSetting(req.app.locals.db, 'security.ip_hash_salt', '');
    const meta = requestMeta(req, salt);
    const result = createPrivacyRequest(req.app.locals.db, req.body, meta);
    const market = getMarket(String(req.body.market || 'en'));
    const redirect = `/${market.prefix}/privacy/request?ref=${encodeURIComponent(result.reference)}`;
    if (acceptsJson(req)) return res.status(201).json({ ok: true, reference: result.reference, redirect });
    return res.redirect(303, redirect);
  } catch (error) {
    return errorResponse(req, res, error);
  }
});

router.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

module.exports = router;

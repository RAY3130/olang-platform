'use strict';

const { nowIso, normalizeText, sha256, parseJson } = require('../lib/util');
const { hasAnalyticsConsent } = require('./consent');
const { getSetting } = require('./settings');
const config = require('../config');

const EVENT_NAMES = new Set([
  // Page and navigation
  'page_view', 'navigation_click', 'language_switch', 'market_switch', 'scroll_depth', 'session_duration',
  // Product discovery and specification
  'product_category_view', 'product_detail_view', 'product_view', 'product_filter', 'product_search',
  'product_compare', 'product_image_switch', 'product_image_zoom', 'gallery_view', 'finish_select',
  'specification_expand', 'specification_download', 'technical_document_download', 'document_request',
  'add_to_quote', 'add_to_inquiry', 'remove_from_inquiry', 'unit_switch',
  // Customization and inquiry
  'customization_start', 'customer_type_select', 'customization_option_select', 'drawing_upload',
  'customizer_step_complete', 'customization_step_view', 'quote_summary_view', 'inquiry_form_start', 'inquiry_form_submit', 'inquiry_submit',
  'inquiry_submit_success', 'inquiry_submit_error', 'inquiry_success', 'inquiry_form_error',
  'inquiry_click', 'oem_inquiry', 'oem_brief_start', 'file_upload', 'spec_request',
  // Assistant
  'chatbot_open', 'chatbot_question', 'chatbot_answer', 'chatbot_feedback', 'chatbot_handoff',
  'assistant_open', 'assistant_question', 'assistant_answer', 'assistant_handoff',
  // Other calibrated actions
  'contact_click', 'catalogue_download', 'whatsapp_click', 'finish_sample_request',
  'outbound_click', 'video_play', 'CTA_click', 'customizer_step_complete',
]);

const ALLOWED_PROP_KEYS = new Set([
  'filter_type', 'filter_value', 'query', 'result_count', 'sku', 'position', 'form_type',
  'document_type', 'document_id', 'cta', 'target', 'depth', 'from_market', 'to_market',
  'from_locale', 'to_locale', 'item_count', 'file_count', 'question_length', 'matched_type',
  'location', 'finish', 'asset', 'page_type', 'market',
  // 2026 interaction additions
  'customer_type', 'option', 'selected', 'step', 'error', 'view', 'category', 'helpful',
  'duration_seconds', 'page_count', 'source', 'project', 'language', 'session_seconds',
]);

function cleanProps(input) {
  const props = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return props;
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      props[key] = value;
    } else {
      const text = normalizeText(value, 200);
      if (text) props[key] = text;
    }
  }
  return props;
}

function sanitizePath(value) {
  const text = normalizeText(value, 300);
  if (!text.startsWith('/') || text.startsWith('//')) return '/';
  return text;
}

function recordEvent(db, body, meta = {}) {
  if (!meta.visitorId) return { ok: false, reason: 'no_visitor' };
  if (!hasAnalyticsConsent(db, meta.visitorId)) return { ok: false, reason: 'no_consent' };
  const eventName = String(body.event_name || '').trim();
  if (!EVENT_NAMES.has(eventName)) return { ok: false, reason: 'invalid_event' };
  const eventId = normalizeText(body.event_id, 80);
  if (!eventId || !/^[A-Za-z0-9_.:-]{8,80}$/.test(eventId)) return { ok: false, reason: 'invalid_event_id' };
  const sessionId = normalizeText(body.session_id, 80) || 'unknown';
  const path = sanitizePath(body.path);
  const market = normalizeText(body.market, 20);
  const locale = normalizeText(body.locale, 10);
  const productSku = normalizeText(body.product_sku, 40).toUpperCase() || null;
  const referrer = normalizeText(body.referrer, 300);
  const pageType = normalizeText(body.page_type, 50);
  const props = cleanProps(body.props);
  const now = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO analytics_events (
      event_id, event_name, visitor_id, session_id, path, page_type, market, locale,
      product_sku, referrer, device, country, consent, props_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    eventId, eventName, meta.visitorId, sessionId, path, pageType || null,
    market || null, locale || null, productSku, referrer || null,
    meta.device || null, meta.country || null, JSON.stringify(props), now,
  );
  return { ok: true };
}

function periodStart(days) {
  if (!days || days === 'all') return null;
  const n = Math.max(1, Math.min(3650, Number(days) || 30));
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

function countRows(db, sql, params = {}) {
  const row = db.prepare(sql).get(params);
  return row ? (row.c || 0) : 0;
}

function dashboardData(db, options = {}) {
  const days = options.days || '30';
  const start = periodStart(days);
  const params = { start: start || '1970-01-01T00:00:00.000Z' };
  const baseline = getSetting(db, 'analytics.baseline_started_at', null);
  const eventWhere = 'created_at >= @start';
  const inquiryWhere = 'created_at >= @start';

  const pageviews = countRows(db, `SELECT COUNT(*) c FROM analytics_events WHERE event_name = 'page_view' AND ${eventWhere}`, params);
  const sessions = countRows(db, `SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE event_name = 'page_view' AND ${eventWhere}`, params);
  const visitors = countRows(db, `SELECT COUNT(DISTINCT visitor_id) c FROM analytics_events WHERE event_name = 'page_view' AND ${eventWhere}`, params);
  const productViews = countRows(db, `SELECT COUNT(*) c FROM analytics_events WHERE event_name = 'product_view' AND ${eventWhere}`, params);
  const productViewSessions = countRows(db, `SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE event_name = 'product_view' AND ${eventWhere}`, params);
  const addSessions = countRows(db, `SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE event_name IN ('add_to_inquiry','inquiry_form_start') AND ${eventWhere}`, params);
  const startSessions = countRows(db, `SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE event_name = 'inquiry_form_start' AND ${eventWhere}`, params);
  const submitEvents = countRows(db, `SELECT COUNT(*) c FROM analytics_events WHERE event_name = 'inquiry_form_submit' AND ${eventWhere}`, params);
  const totalInquiries = countRows(db, `SELECT COUNT(*) c FROM inquiries WHERE ${inquiryWhere}`, params);
  const openInquiries = countRows(db, `SELECT COUNT(*) c FROM inquiries WHERE status NOT IN ('won','lost','archived')`, {});
  const newInquiries = countRows(db, `SELECT COUNT(*) c FROM inquiries WHERE status = 'new'`, {});

  const marketRows = db.prepare(`
    SELECT COALESCE(market, 'unknown') AS market,
           COUNT(DISTINCT session_id) AS sessions,
           SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) AS pageviews,
           SUM(CASE WHEN event_name = 'inquiry_form_submit' THEN 1 ELSE 0 END) AS submits
    FROM analytics_events WHERE ${eventWhere}
    GROUP BY market ORDER BY sessions DESC
  `).all(params);
  const inquiryMarketRows = db.prepare(`
    SELECT market, COUNT(*) AS inquiries FROM inquiries WHERE ${inquiryWhere} GROUP BY market
  `).all(params);
  const inquiryMarket = Object.fromEntries(inquiryMarketRows.map((row) => [row.market, row.inquiries]));
  const markets = marketRows.map((row) => ({ ...row, inquiries: inquiryMarket[row.market] || 0 }));

  const localeRows = db.prepare(`
    SELECT COALESCE(locale, 'unknown') AS locale,
           COUNT(DISTINCT session_id) AS sessions,
           SUM(CASE WHEN event_name = 'inquiry_form_submit' THEN 1 ELSE 0 END) AS submits
    FROM analytics_events WHERE ${eventWhere}
    GROUP BY locale ORDER BY sessions DESC
  `).all(params);

  const deviceRows = db.prepare(`
    SELECT COALESCE(device, 'unknown') AS device,
           COUNT(DISTINCT session_id) AS sessions,
           SUM(CASE WHEN event_name = 'inquiry_form_submit' THEN 1 ELSE 0 END) AS submits
    FROM analytics_events WHERE ${eventWhere}
    GROUP BY device ORDER BY sessions DESC
  `).all(params);

  const topProducts = db.prepare(`
    SELECT product_sku,
           SUM(CASE WHEN event_name = 'product_view' THEN 1 ELSE 0 END) AS views,
           SUM(CASE WHEN event_name = 'add_to_inquiry' THEN 1 ELSE 0 END) AS adds,
           SUM(CASE WHEN event_name = 'inquiry_form_submit' THEN 1 ELSE 0 END) AS submits
    FROM analytics_events
    WHERE ${eventWhere} AND product_sku IS NOT NULL AND product_sku <> ''
    GROUP BY product_sku ORDER BY views DESC, adds DESC LIMIT 12
  `).all(params);

  const sourcePages = db.prepare(`
    SELECT path, COUNT(*) AS starts,
           SUM(CASE WHEN event_name = 'inquiry_form_submit' THEN 1 ELSE 0 END) AS submits
    FROM analytics_events
    WHERE ${eventWhere} AND event_name IN ('inquiry_form_start','inquiry_form_submit')
    GROUP BY path ORDER BY starts DESC LIMIT 12
  `).all(params);

  const inquiryTypes = db.prepare(`
    SELECT type, COUNT(*) AS count FROM inquiries WHERE ${inquiryWhere} GROUP BY type ORDER BY count DESC
  `).all(params);

  const documentRequests = countRows(db, `
    SELECT COUNT(*) c FROM inquiries i
    WHERE i.type = 'document_request' AND i.created_at >= @start
  `, params);

  const formSubmitsByType = db.prepare(`
    SELECT json_extract(props_json, '$.form_type') AS form_type, COUNT(*) AS count
    FROM analytics_events WHERE ${eventWhere} AND event_name = 'inquiry_form_submit'
    GROUP BY form_type ORDER BY count DESC
  `).all(params);

  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS count FROM inquiries GROUP BY status
  `).all();

  const funnel = [
    { key: 'sessions', label: 'Sessions with a page view', count: sessions },
    { key: 'product_views', label: 'Sessions with a product view', count: productViewSessions },
    { key: 'added_or_started', label: 'Sessions with list add or form start', count: addSessions },
    { key: 'form_started', label: 'Sessions that started an inquiry form', count: startSessions },
    { key: 'submitted', label: 'Inquiry submit events', count: submitEvents },
    { key: 'portal_inquiries', label: 'Inquiries recorded in the portal', count: totalInquiries },
  ];

  return {
    days,
    start,
    baseline,
    kpis: {
      sessions, visitors, pageviews, productViews, totalInquiries, openInquiries, newInquiries,
      documentRequests, submitEvents,
      conversion: sessions > 0 ? (totalInquiries / sessions) * 100 : null,
    },
    markets,
    locales: localeRows,
    devices: deviceRows,
    topProducts,
    sourcePages,
    inquiryTypes,
    formSubmitsByType,
    statuses: statusRows,
    funnel,
    empty: pageviews === 0 && totalInquiries === 0,
    consentNote: 'Analytics counts include only visitors who allowed first-party analytics. Portal inquiry counts include all inquiries. Rates mix the two sources and must be read with that limitation.',
    baselineNote: 'There is no verified production baseline from the old website in this database. The baseline starts when this deployment begins recording; do not present percentage improvements as measured results.',
  };
}

function pruneAnalytics(db, days = config.privacy.analyticsRetentionDays) {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const result = db.prepare('DELETE FROM analytics_events WHERE created_at < ?').run(cutoff);
  db.prepare('DELETE FROM assistant_queries WHERE created_at < ?').run(cutoff);
  db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(Math.floor(Date.now() / 1000) - 86400);
  return Number(result.changes || 0);
}

function listRecentEvents(db, limit = 50) {
  return db.prepare(`
    SELECT event_name, path, market, locale, product_sku, device, country, created_at
    FROM analytics_events ORDER BY created_at DESC LIMIT ?
  `).all(Math.min(200, Math.max(1, Number(limit) || 50)));
}

function exportEvents(db) {
  return db.prepare(`
    SELECT event_id, event_name, path, market, locale, product_sku, device, country,
           referrer, props_json, created_at
    FROM analytics_events ORDER BY created_at
  `).all();
}

module.exports = {
  EVENT_NAMES, recordEvent, dashboardData, pruneAnalytics, listRecentEvents, exportEvents,
  cleanProps, sanitizePath,
};

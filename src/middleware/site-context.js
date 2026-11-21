'use strict';

const config = require('../config');
const { getMarket, alternateLinks, MARKETS, MARKET_ORDER, localizedMarketName, languageName } = require('../i18n/markets');
const { makeTranslator, pageCopy } = require('../i18n');
const { navLabels } = require('../i18n/nav');
const { customizerCopy } = require('../i18n/customizer-copy');
const { presentationCopy, useText, seriesSlug } = require('../i18n/presentation-copy');
const { PRESENTATION } = require('../i18n/client-v3');
const { serializeCookie, appendCookie } = require('../lib/cookies');
const { getPageContent } = require('../services/content');
const { getAllCategories } = require('../services/products');
const { getConsent } = require('../services/consent');
const { getMarketSettings, allMarketSettings } = require('../services/market-config');
const { companyCommon } = require('../content/company-pages');
const { localizedSeries, localizedCategory } = require('../i18n/glossary');
const { formatDate, formatDateTime } = require('../lib/util');
const fs = require('node:fs');
const path = require('node:path');

// The catalogue size is printed next to the download link, so it must be the real file size.
let catalogueBytesCache = null;
function catalogueBytes() {
  if (catalogueBytesCache !== null) return catalogueBytesCache;
  try {
    catalogueBytesCache = fs.statSync(path.join(config.root, 'public', config.catalogue.path.replace(/^\//, ''))).size;
  } catch (_) {
    catalogueBytesCache = 0;
  }
  return catalogueBytesCache;
}

function resolveMarket(req) {
  const first = String(req.path || '/').split('/').filter(Boolean)[0];
  return Object.values(MARKETS).find((market) => market.prefix === first) || null;
}

function marketSuffix(req, market) {
  if (!market) return '';
  const prefix = `/${market.prefix}`;
  const path = String(req.path || '/');
  if (path === prefix) return '';
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return path;
}

function cookieOptions(extra = {}) {
  return {
    secure: config.sessionCookieSecure,
    sameSite: 'Lax',
    path: '/',
    ...extra,
  };
}

function siteContext(db) {
  return function site(req, res, next) {
    const baseMarket = resolveMarket(req) || getMarket('en');
    const locale = baseMarket.locale;
    const market = getMarketSettings(db, baseMarket.code, locale);
    const suffix = marketSuffix(req, baseMarket);
    const t = makeTranslator(locale);
    const contentCache = {};
    const contentFor = (pageKey) => {
      if (!contentCache[pageKey]) {
        contentCache[pageKey] = getPageContent(db, pageKey, locale, market.code);
      }
      return contentCache[pageKey];
    };
    req.market = market;
    req.locale = locale;
    req.marketSuffix = suffix;
    req.t = t;
    req.contentFor = contentFor;
    req.siteDb = db;
    res.locals.site = {
      mode: config.siteMode,
      demo: config.isDemo,
      url: config.siteUrl,
      name: config.siteName,
      contact: config.publicContact,
      whatsappUrl: config.whatsappUrl,
      address: config.publicContact.address,
      cataloguePath: config.catalogue.path,
      catalogueBytes: catalogueBytes(),
      cookiePolicyVersion: config.privacy.cookiePolicyVersion,
    };
    res.locals.currentPath = req.path;
    res.locals.currentSuffix = suffix;
    res.locals.urlFor = (suffixPath = '') => {
      const clean = String(suffixPath || '').replace(/^\/+/, '');
      return clean ? `/${market.prefix}/${clean}` : `/${market.prefix}`;
    };
    res.locals.market = market;
    res.locals.locale = locale;
    res.locals.companyNav = companyCommon(locale);
    res.locals.navLabels = navLabels(locale);
    res.locals.cc = customizerCopy(locale);
    res.locals.pc = { ...presentationCopy(locale), ...(PRESENTATION[locale] || {}) };
    res.locals.productUse = (categoryKey) => useText(categoryKey, locale);
    res.locals.seriesSlug = (series) => seriesSlug(series);
    res.locals.localizedMarketName = (code) => localizedMarketName(code, locale);
    res.locals.localizedSeries = (series) => localizedSeries(series, locale);
    res.locals.localizedCategory = (key) => localizedCategory(key, locale);
    res.locals.languageName = (code) => languageName(code, locale);
    res.locals.t = t;
    res.locals.dict = t.dict;
    res.locals.markets = Object.fromEntries(allMarketSettings(db, locale).map((entry) => [entry.code, entry]));
    res.locals.marketOrder = MARKET_ORDER;
    res.locals.alternates = alternateLinks(suffix).map((entry) => ({
      ...entry,
      url: `${config.siteUrl}${entry.url}`,
    }));
    res.locals.canonical = `${config.siteUrl}${req.path}`;
    res.locals.categories = getAllCategories(db, locale);
    res.locals.nav = t.dict.common ? {
      products: t('common.product'),
    } : {};
    res.locals.pageMeta = {
      title: config.siteName,
      description: t('pages.home.metaDescription'),
      robots: config.isDemo ? 'noindex,nofollow' : 'index,follow',
      ogType: 'website',
      ogImage: `${config.siteUrl}/images/products/robe-hook-ol-1204.jpg`,
    };
    res.locals.breadcrumbs = [];
    res.locals.pageType = 'page';
    res.locals.productSku = '';
    res.locals.consent = getConsent(db, req.visitorId);
    res.locals.consentKnown = res.locals.consent !== null;
    res.locals.formErrorCode = typeof req.query.form_error === 'string' ? req.query.form_error.slice(0, 40) : '';
    res.locals.contentFor = contentFor;
    res.locals.bodyClass = '';
    res.locals.cspNonce = res.locals.cspNonce || '';
    res.locals.formatDate = (value) => formatDate(value, locale);
    res.locals.formatDateTime = (value) => formatDateTime(value, locale);

    if (req.cookies && req.cookies.olang_market !== market.code) {
      appendCookie(res, serializeCookie('olang_market', market.code, cookieOptions({
        httpOnly: false, sameSite: 'Lax', maxAge: 365 * 24 * 3600,
      })));
    }
    next();
  };
}

function pageContent(db) {
  return function attach(req, res, next) {
    const key = res.locals.contentPageKey;
    if (!key) return next();
    res.locals.copy = req.contentFor ? req.contentFor(key) : pageCopy(req.locale, key);
    next();
  };
}

module.exports = { resolveMarket, marketSuffix, siteContext, pageContent };

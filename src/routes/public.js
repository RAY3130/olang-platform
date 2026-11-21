'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { MARKETS, MARKET_ORDER, getMarket, getMarketByPrefix, alternateLinks } = require('../i18n/markets');
const { publicContext } = require('../middleware/public-context');
const { siteContext } = require('../middleware/site-context');
const { renderPage } = require('../lib/view');
const { formatDate, normalizeText, clampInt, parseJson } = require('../lib/util');
const { getAllCategories, getCategoryBySlug, listProducts, getProductBySlug, getRelatedProducts, getSeriesFacet, getCollectionFacet, getSeriesFinishes, getFinishFacet, getAttributeFacet, getProductsBySkus, getMarketFeaturedProducts, customerStatus } = require('../services/products');
const { seriesSlug, useText } = require('../i18n/presentation-copy');
const { homeEditorial } = require('../i18n/v3-home');
const { productIntroFor } = require('../i18n/product-specific');
const { referenceSet, seriesReference, sceneReference } = require('../lib/reference-library');
const { listNews, getNewsBySlug, relatedNews } = require('../services/news');
const { specValue } = require('../lib/measure');
const { buildProcurementRows } = require('../lib/procurement');
const { buildProductSeo } = require('../lib/product-seo');
const { companyPage, companyCommon } = require('../content/company-pages');
const { displayAttributeValue, localizedSeries } = require('../i18n/glossary');
const { listDocuments, getDocumentById, getPublicDownload, documentTypeLabel, DOC_TYPES } = require('../services/documents');
const { listFaqs } = require('../services/faqs');
const { getProductMedia } = require('../services/media');
const { getInquiryByReference, getInquiryDetail } = require('../services/inquiries');
const { getCustomizationByReference } = require('../services/customization');
const { recordEvent } = require('../services/analytics');
const { requestMeta } = require('../lib/request');
const { getSetting } = require('../services/settings');
const { organization, website, breadcrumbList, productSchema, collectionSchema, serviceSchema, absolute } = require('../lib/schema');

const router = express.Router();
const HOME_LABEL = { en: 'Home', de: 'Startseite', it: 'Home', ja: 'ホーム' };

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ctx(req, res, next) {
  return publicContext(req.app.locals.db)(req, res, next);
}

function siteCtx(req, res, next) {
  return siteContext(req.app.locals.db)(req, res, next);
}

function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match));
}

const SOLUTION_SLUGS = ['hospitality-bathrooms', 'residential-bathrooms', 'commercial-washrooms', 'bathroom-renovation', 'distributor-assortment'];
const SELECTOR_SPACES = {
  hospitality: ['robe-hook', 'towel-ring', 'single-towel-bar', 'double-towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'corner-shelf'],
  residential: ['robe-hook', 'towel-ring', 'single-towel-bar', 'double-towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'toilet-brush-holder', 'corner-shelf'],
  accessible: ['grab-bar'],
  commercial: ['robe-hook', 'towel-ring', 'single-towel-bar', 'double-towel-bar', 'toilet-paper-holder', 'grab-bar', 'corner-shelf'],
};
const SOLUTION_CATEGORIES = {
  'hospitality-bathrooms': ['robe-hook', 'towel-ring', 'towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'grab-bar', 'corner-shelf'],
  'residential-bathrooms': ['robe-hook', 'towel-ring', 'towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'corner-shelf'],
  'commercial-washrooms': ['robe-hook', 'towel-ring', 'toilet-paper-holder', 'grab-bar', 'corner-shelf'],
  'bathroom-renovation': ['robe-hook', 'towel-ring', 'towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'corner-shelf'],
  'distributor-assortment': ['robe-hook', 'towel-ring', 'towel-bar', 'toilet-paper-holder', 'tumbler-holder', 'grab-bar', 'corner-shelf'],
};

function homeFor(req) {
  return `/${req.market.prefix}`;
}

function urlFor(req, suffix) {
  const clean = String(suffix || '').replace(/^\/+/, '');
  return clean ? `/${req.market.prefix}/${clean}` : `/${req.market.prefix}`;
}

function absoluteImage(req, imagePath) {
  if (!imagePath) return `${config.siteUrl}/images/products/robe-hook-ol-1204.jpg`;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  return `${config.siteUrl}/${String(imagePath).replace(/^\/+/, '')}`;
}

function safeQuery(value, max = 120) {
  return normalizeText(value, max);
}

function sendPage(req, res, view, data, meta = {}) {
  const breadcrumbs = meta.breadcrumbs || [];
  const pagesSchema = [];
  if (breadcrumbs.length) pagesSchema.push(breadcrumbList(breadcrumbs));
  const siteSchemas = [organization(), website()];
  const jsonLd = [...siteSchemas, ...pagesSchema, ...(meta.jsonLd || [])];
  let title = meta.title || data.copy?.metaTitle || config.siteName;
  const pageMeta = {
    title,
    description: meta.description || data.copy?.metaDescription || '',
    robots: !config.indexingAllowed ? 'noindex,nofollow' : (meta.noindex ? 'noindex,follow' : 'index,follow'),
    canonical: `${config.siteUrl}${meta.canonicalPath || req.path}`,
    ogType: meta.ogType || 'website',
    ogImage: meta.ogImage || `${config.siteUrl}/images/products/robe-hook-ol-1204.jpg`,
    ogImageAlt: meta.ogImageAlt || 'OLANG bathroom hardware',
    currentPath: req.path,
    noindex: !config.indexingAllowed || Boolean(meta.noindex),
  };
  return renderPage(res, view, {
    ...data,
    pageMeta,
    breadcrumbs,
    jsonLd,
    pageType: meta.pageType || 'page',
    productSku: meta.productSku || '',
    bodyClass: meta.bodyClass || '',
    htmlLang: req.market.htmlLang,
    alternateLinks: alternateLinks(req.marketSuffix).map((entry) => ({ ...entry, url: `${config.siteUrl}${entry.url}` })),
    xDefault: `${config.siteUrl}/en-gb${req.marketSuffix}`,
    nonce: res.locals.cspNonce,
  });
}

function notFound(req, res, status = 404) {
  res.status(status);
  return sendPage(req, res, 'not-found', {
    copy: req.t.dict.pages.notFound,
    title: req.t('pages.notFound.metaTitle'),
    description: req.t('pages.notFound.metaDescription'),
  }, {
    title: req.t('pages.notFound.metaTitle'),
    description: req.t('pages.notFound.metaDescription'),
    pageType: 'error',
    noindex: true,
  });
}

// ---------------------------------------------------------------------------
// Entry and legacy redirects
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  let target = null;
  const cookieMarket = req.cookies && req.cookies.olang_market;
  if (cookieMarket && MARKETS[cookieMarket]) target = MARKETS[cookieMarket].prefix;
  if (!target) {
    const languages = String(req.headers['accept-language'] || '').toLowerCase();
    if (/(^|,)\s*de\b/.test(languages)) target = 'de-de';
    else if (/(^|,)\s*ja\b/.test(languages)) target = 'ja-jp';
    else target = 'en-gb';
  }
  return res.redirect(302, `/${target}`);
});

// Retired editions and short prefixes keep a single 301 hop to the published edition.
router.get(['/uk', '/en'], (req, res) => res.redirect(301, '/en-gb'));
router.get(['/de', '/de-at', '/de-ch'], (req, res) => res.redirect(301, '/de-de'));
router.get(['/jp', '/ja'], (req, res) => res.redirect(301, '/ja-jp'));
router.get(['/us', '/en-us', '/au', '/en-au', '/it'], (req, res) => res.redirect(301, '/en-gb'));
router.get('/global', (req, res) => res.redirect(301, '/en-gb'));
router.get('/academic-notice', (req, res) => res.redirect(301, '/en-gb/legal'));
router.get('/insights', (req, res) => res.redirect(301, '/en-gb/resources'));

const LEGACY = {
  '/products': '/en-gb/products',
  '/wholesale': '/en-gb/wholesale',
  '/source-wholesale': '/en-gb/wholesale',
  '/oem': '/en-gb/customization',
  '/custom-oem': '/en-gb/customization',
  '/customization': '/en-gb/customization',
  '/projects': '/en-gb/projects',
  '/company': '/en-gb/about',
  '/resources': '/en-gb/resources',
  '/contact': '/en-gb/contact',
  '/privacy': '/en-gb/privacy',
};
for (const [from, to] of Object.entries(LEGACY)) {
  router.get(from, (req, res) => res.redirect(301, `${to}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
}
router.get('/products/:legacySlug', (req, res) => {
  const slug = String(req.params.legacySlug);
  if (slug === 'index.html') return res.redirect(301, '/en-gb/products');
  return res.redirect(301, `/en-gb/products/${slug.replace(/\.html$/i, '')}`);
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  if (!config.indexingAllowed) {
    return res.send('# Search indexing is disabled for this deployment.\nUser-agent: *\nDisallow: /\n');
  }
  return res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /*/compare\nDisallow: /*/inquiry\nDisallow: /*/success\nDisallow: /*/privacy/request\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const baseline = getSetting(req.app.locals.db, 'analytics.baseline_started_at', new Date().toISOString()).slice(0, 10);
  const products = listProducts(req.app.locals.db, { locale: 'en' });
  const news = listNews(req.app.locals.db, { locale: 'en', limit: 50 }).rows;
  const paths = ['', '/products', '/series', '/selector', '/news', '/solutions', '/wholesale', '/customization', '/oem', '/projects', '/about', '/about/culture', '/about/development', '/about/honor', '/about/factory', '/about/quality', '/resources', '/contact', '/privacy', '/legal'];
  const sitemapSeries = getSeriesFacet(req.app.locals.db);
  const solutionSlugs = ['hospitality-bathrooms', 'residential-bathrooms', 'commercial-washrooms', 'bathroom-renovation', 'distributor-assortment'];
  const urls = [];
  const categoryRows = req.app.locals.db.prepare('SELECT slug FROM categories WHERE published = 1 ORDER BY sort_order').all();
  for (const marketCode of MARKET_ORDER) {
    const prefix = getMarket(marketCode).prefix;
    for (const suffix of paths) {
      urls.push({ loc: `${config.siteUrl}/${prefix}${suffix}`, alternates: alternateLinks(suffix), suffix });
    }
    for (const slug of solutionSlugs) {
      urls.push({ loc: `${config.siteUrl}/${prefix}/solutions/${slug}`, alternates: alternateLinks(`/solutions/${slug}`), suffix: `/solutions/${slug}` });
    }
    for (const category of categoryRows) {
      const suffix = `/products/category/${category.slug}`;
      urls.push({ loc: `${config.siteUrl}/${prefix}${suffix}`, alternates: alternateLinks(suffix), suffix });
    }
    for (const seriesRow of sitemapSeries) {
      const suffix = `/series/${seriesSlug(seriesRow.series)}`;
      urls.push({ loc: `${config.siteUrl}/${prefix}${suffix}`, alternates: alternateLinks(suffix), suffix });
    }
    for (const product of products) {
      urls.push({ loc: `${config.siteUrl}/${prefix}/products/${product.slug}`, alternates: alternateLinks(`/products/${product.slug}`), suffix: `/products/${product.slug}` });
    }
    for (const article of news) {
      urls.push({ loc: `${config.siteUrl}/${prefix}/news/${article.slug}`, alternates: alternateLinks(`/news/${article.slug}`), suffix: `/news/${article.slug}` });
    }
    const caseRows = req.app.locals.db.prepare('SELECT slug FROM case_studies WHERE published = 1').all();
    for (const caseRow of caseRows) {
      urls.push({ loc: `${config.siteUrl}/${prefix}/projects/${caseRow.slug}`, alternates: alternateLinks(`/projects/${caseRow.slug}`), suffix: `/projects/${caseRow.slug}` });
    }
  }
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  for (const entry of urls) {
    xml.push('<url>');
    xml.push(`<loc>${entry.loc.replace(/&/g, '&amp;')}</loc>`);
    xml.push(`<lastmod>${baseline}</lastmod>`);
    for (const alt of entry.alternates) {
      xml.push(`<xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${config.siteUrl}${alt.url}"/>`);
    }
    xml.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${config.siteUrl}/en-gb${entry.suffix || ''}"/>`);
    xml.push('</url>');
  }
  xml.push('</urlset>');
  res.type('application/xml').send(xml.join('\n'));
});

// ---------------------------------------------------------------------------
// Public document download (only files explicitly approved as public)
// ---------------------------------------------------------------------------
router.get('/documents/:id/download', ctx, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const download = getPublicDownload(db, Number(req.params.id));
  if (!download) return res.status(404).send('Document not found or not public.');
  const { document, file } = download;
  if (req.analyticsConsent) {
    try {
      recordEvent(db, {
        event_id: `evt_doc_${document.id}_${Date.now().toString(36)}`,
        event_name: 'specification_download',
        session_id: 'document-download',
        path: req.path,
        page_type: 'document',
        market: 'en',
        locale: 'en',
        props: { document_id: document.id, document_type: document.doc_type, sku: document.sku || '' },
      }, requestMeta(req, getSetting(db, 'security.ip_hash_salt', '')));
    } catch (_) { /* download must not fail because analytics failed */ }
  }
  res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${String(document.original_name || 'document').replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  fs.createReadStream(file).pipe(res);
}));

// ---------------------------------------------------------------------------
// Market-scoped public pages
// ---------------------------------------------------------------------------
const marketRoutes = [];
for (const market of Object.values(MARKETS)) {
  const prefix = market.prefix;

  router.get(`/${prefix}`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('home');
    const products = getMarketFeaturedProducts(db, req.market.code, req.locale, 8);
    const categories = getAllCategories(db, req.locale);
    const news = listNews(db, { locale: req.locale, limit: 3 }).rows;
    const newsCopy = companyPage(req.locale, 'news');
    const projectReferences = db.prepare(`
      SELECT * FROM case_studies WHERE published = 1
      ORDER BY CASE verification_status WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC LIMIT 3
    `).all();
    const catalogSummary = {
      products: db.prepare('SELECT COUNT(*) AS c FROM products WHERE published = 1').get().c,
      categories: db.prepare('SELECT COUNT(*) AS c FROM categories WHERE published = 1').get().c,
      series: db.prepare("SELECT COUNT(DISTINCT series) AS c FROM products WHERE published = 1 AND series LIKE '% Series'").get().c,
      construction: db.prepare("SELECT COUNT(*) AS c FROM products WHERE published = 1 AND collection = 'construction-hardware'").get().c,
    };
    const customerTypes = copy.customerTypes.map((item) => ({
      ...item,
      href: item.target === 'projects' ? urlFor(req, 'projects') : urlFor(req, item.target === 'oem' ? 'oem' : 'wholesale'),
    }));
    const referenceMarket = req.market.code === 'de' ? 'de-de' : req.market.code;
    const reference = referenceSet(referenceMarket);
    const seriesRows = getSeriesFacet(db)
      .filter((row) => row.series !== 'Engineering Hardware')
      .map((row, index) => ({
        ...row,
        finishCount: getSeriesFinishes(db, row.series, req.locale).length,
        reference: seriesReference(referenceMarket, index),
      }));
    const finishes = getFinishFacet(db, req.locale);
    return sendPage(req, res, 'home', {
      copy,
      hc: homeEditorial(req.locale),
      products,
      categories,
      customerTypes,
      news,
      newsCopy,
      projectReferences,
      catalogSummary,
      reference,
      referenceImage: reference.hero,
      seriesRows,
      finishCount: finishes.length,
      spaceImages: reference.all.filter((image) => image.kind !== 'hero').slice(0, 4),
      marketInfo: req.market,
      marketBrief: req.market,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'home',
      jsonLd: [{
        '@type': 'WebPage',
        name: copy.metaTitle,
        description: copy.metaDescription,
        url: `${config.siteUrl}/${prefix}`,
        inLanguage: req.market.htmlLang,
      }],
    });
  }));

  const renderProductList = asyncHandler(async (req, res, forcedCategory = null) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('products');
    const categoryRow = forcedCategory ? getCategoryBySlug(db, forcedCategory, req.locale) : null;
    if (forcedCategory && !categoryRow) return notFound(req, res);
    const filters = {
      category: forcedCategory || safeQuery(req.query.category, 80),
      series: safeQuery(req.query.series, 80),
      collection: safeQuery(req.query.collection, 80),
      finish: safeQuery(req.query.finish, 80),
      material: safeQuery(req.query.material, 100),
      application: safeQuery(req.query.application, 100),
      oem: safeQuery(req.query.oem, 10) === 'yes' ? 'yes' : '',
      q: safeQuery(req.query.q, 120),
      sort: ['sku', 'name', 'category', 'newest'].includes(String(req.query.sort)) ? String(req.query.sort) : '',
    };
    const products = listProducts(db, { ...filters, locale: req.locale });
    const categories = getAllCategories(db, req.locale);
    const series = getSeriesFacet(db);
    const collections = getCollectionFacet(db);
    const finishes = getFinishFacet(db, req.locale);
    const materials = getAttributeFacet(db, 'material');
    const applications = getAttributeFacet(db, 'applicable_environment');
    const oemFacet = getAttributeFacet(db, 'customization');
    const activeFilters = Object.entries(filters).filter(([key, value]) => value && !['sort'].includes(key) && !(forcedCategory && key === 'category'));
    const hasQuery = activeFilters.length > 0 || filters.sort;
    const pageTitle = categoryRow ? `${categoryRow.name} · ${products.length} ${req.t('common.models')} | OLANG` : copy.metaTitle;
    const pageDescription = categoryRow
      ? `${res.locals.pc.productsLede} ${categoryRow.name}`.slice(0, 300)
      : copy.metaDescription;
    const breadcrumbs = categoryRow ? [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: req.t.dict.pages.product.breadcrumbProducts, url: `/${prefix}/products` },
      { name: categoryRow.name, url: req.path },
    ] : [];
    const referenceMarket = req.market.code === 'de' ? 'de-de' : req.market.code;
    const reference = referenceSet(referenceMarket);
    return sendPage(req, res, 'products', {
      marketReference: reference.styles[0] || reference.all[0] || null,
      referenceStrip: [reference.styles[1], reference.details[0]].filter(Boolean),
      copy,
      products,
      categories,
      series,
      collections,
      finishes,
      materials,
      applications,
      oemFacet,
      filters,
      activeFilters,
      resultCount: products.length,
      hasQuery,
      categoryPage: categoryRow,
      breadcrumbs,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: pageTitle,
      description: pageDescription,
      pageType: 'product_category',
      breadcrumbs,
      noindex: Boolean(hasQuery),
      canonicalPath: hasQuery ? (categoryRow ? `/${prefix}/products/category/${categoryRow.slug}` : `/${prefix}/products`) : req.path,
      jsonLd: [collectionSchema(pageTitle, req.path, products.map((product) => ({ ...product, marketPrefix: prefix })))],
    });
  });

  router.get(`/${prefix}/products`, ctx, siteCtx, (req, res) => renderProductList(req, res));
  router.get(`/${prefix}/products/category/:slug`, ctx, siteCtx, (req, res) => renderProductList(req, res, String(req.params.slug || '')));

  router.get(`/${prefix}/products/:slug`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const slug = String(req.params.slug || '');
    if (slug.endsWith('.html')) return res.redirect(301, `/${prefix}/products/${slug.replace(/\.html$/i, '')}`);
    if (slug === 'index') return res.redirect(301, `/${prefix}/products`);
    const product = getProductBySlug(db, slug, req.locale);
    if (!product) return notFound(req, res);
    const copy = req.contentFor('products');
    const productCopy = req.t.dict.pages.product;
    const related = getRelatedProducts(db, product, req.locale, 4);
    const seriesSiblings = product.series
      ? listProducts(db, { series: product.series, locale: req.locale, sort: 'sku' }).map((sib) => {
        let siblingsColors = [];
        try { siblingsColors = JSON.parse(sib.colors_json || '[]'); } catch (_) { siblingsColors = []; }
        return {
          ...sib,
          matrix_finish: siblingsColors.map((color) => color.name).filter(Boolean).slice(0, 4).join(' · '),
          matrix_dimensions: sib.card_dimensions || '',
          matrix_moq: (db.prepare('SELECT value FROM product_attributes WHERE product_id = ? AND attr_key = ?').get(sib.id, 'moq') || {}).value || '',
        };
      })
      : [];
    const mediaRegistry = getProductMedia(db, product.id);
    const documents = listDocuments(db, { locale: req.locale, market: req.market.code, productId: product.id });
    const referenceMarket = req.market.code === 'de' ? 'de-de' : req.market.code;
    const reference = referenceSet(referenceMarket);
    const referenceDetail = reference.details[0] || reference.styles[0] || null;
    const referenceInstall = reference.installs[0] || reference.styles[1] || null;
    const seo = buildProductSeo(product, req.locale);
    const title = seo.title;
    const description = seo.description;
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: productCopy.breadcrumbProducts, url: `/${prefix}/products` },
      { name: `${product.name} ${product.sku}`, url: req.path },
    ];
    return sendPage(req, res, 'product', {
      copy: productCopy,
      productsCopy: copy,
      product: { ...product, heading: seo.h1 },
      productIntro: productIntroFor(product.sku, req.locale)
        || `${product.sku}${product.series ? ' · ' + localizedSeries(product.series, req.locale) : ''}. ${useText(product.category_key, req.locale)}`,
      materialDisplay: product.attrMap.material && product.attrMap.material.value
        ? displayAttributeValue(product.attrMap.material.value, req.locale)
        : '',
      related,
      seriesSiblings,
      documents,
      referenceDetail,
      referenceInstall,
      breadcrumbs,
      specRows: (() => {
        const rows = buildProcurementRows(product, req.market);
        return rows;
      })(),
      media: (() => {
        const widths = [1600, 800];
        const webp = widths.map((w) => `/images/products/official/responsive/${product.sku}-${w}.webp ${w}w`).join(', ');
        const ratioClass = product.presentationRatioClass || '4x3';
        return {
          main: {
            src: `/images/products/official/responsive/${product.sku}-1600.webp`,
            full: `/images/products/official/${product.sku}.jpg`,
            avifSrcset: null,
            webpSrcset: webp,
            width: product.imageNaturalWidth || null,
            height: product.imageNaturalHeight || null,
            ratioClass,
            alt: `${product.name} ${product.sku} — ${req.t('photo.source')}`,
          },
          thumb: `/images/products/official/cards/${product.sku}.jpg`,
        };
      })(),
      specValue: (attr, field) => specValue(attr, field, req.market),
      statusKey: customerStatus,
      urlFor: (path) => urlFor(req, path),
      documentTypeLabel: (type) => documentTypeLabel(type, req.locale),
    }, {
      title,
      description,
      pageType: 'product',
      productSku: product.sku,
      ogType: 'product',
      ogImage: absoluteImage(req, product.image_path),
      ogImageAlt: `${product.name} ${product.sku}`,
      breadcrumbs,
      jsonLd: [productSchema(product, req.market)],
    });
  }));

  router.get(`/${prefix}/series`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const referenceMarket = req.market.code === 'de' ? 'de-de' : req.market.code;
    const rows = getSeriesFacet(db).filter((row) => row.series !== 'Engineering Hardware').map((row, index) => ({
      ...row,
      finishCount: getSeriesFinishes(db, row.series, req.locale).length,
      reference: seriesReference(referenceMarket, index),
    }));
    return sendPage(req, res, 'series-index', {
      rows,
      seriesName: req.t('common.series'),
      breadcrumbs: [
        { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
        { name: req.t('common.series'), url: req.path },
      ],
      urlFor: (target) => urlFor(req, target),
    }, {
      title: `${req.t('common.series')} | OLANG`,
      description: req.locale === 'de' ? 'Die sieben OLANG-Serien im Vergleich.' : req.locale === 'ja' ? 'OLANGの7シリーズ一覧。' : 'The seven OLANG bathroom hardware series.',
      pageType: 'series',
      canonicalPath: `/${prefix}/series`,
    });
  }));

  router.get(`/${prefix}/series/:slug`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const rows = getSeriesFacet(db);
    const seriesRow = rows.find((row) => seriesSlug(row.series) === String(req.params.slug || ''));
    if (!seriesRow) return notFound(req, res);
    const products = listProducts(db, { series: seriesRow.series, locale: req.locale, sort: 'sku' });
    const seriesName = localizedSeries(seriesRow.series, req.locale);
    const seriesFinishes = getSeriesFinishes(db, seriesRow.series, req.locale);
    const referenceMarket = req.market.code === 'de' ? 'de-de' : req.market.code;
    const allSeries = getSeriesFacet(db);
    const seriesIndex = Math.max(0, allSeries.findIndex((row) => row.series === seriesRow.series));
    const reference = seriesReference(referenceMarket, seriesIndex);
    const pc = res.locals.pc;
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: req.t.dict.pages.product.breadcrumbProducts, url: `/${prefix}/products` },
      { name: seriesName, url: req.path },
    ];
    return sendPage(req, res, 'series', {
      seriesRow,
      seriesName,
      seriesHref: urlFor(req, `series/${seriesSlug(seriesRow.series)}`),
      products,
      seriesFinishes,
      reference,
      breadcrumbs,
      copy: req.contentFor('products'),
      pc,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: `${seriesName} · ${products.length} ${req.t('common.models')} | OLANG`,
      description: `${seriesName}: ${pc.seriesIntro}`.slice(0, 300),
      pageType: 'series',
      breadcrumbs,
      canonicalPath: `/${prefix}/series/${seriesSlug(seriesRow.series)}`,
      jsonLd: [collectionSchema(seriesName, req.path, products.map((product) => ({ ...product, marketPrefix: prefix })))],
    });
  }));

  router.get(`/${prefix}/selector`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const pc = res.locals.pc;
    const spaces = ['hospitality', 'residential', 'accessible', 'commercial'];
    const space = spaces.includes(String(req.query.space)) ? String(req.query.space) : '';
    const seriesOptions = getSeriesFacet(db);
    const requestedSeries = safeQuery(req.query.series, 80);
    const series = requestedSeries && seriesOptions.some((row) => row.series === requestedSeries) ? requestedSeries : '';
    const finishes = getFinishFacet(db, req.locale);
    const requestedFinish = safeQuery(req.query.finish, 80);
    const finish = requestedFinish && finishes.some((row) => row.code === requestedFinish) ? requestedFinish : '';
    const hasSelection = Boolean(space || series || finish);
    let products = hasSelection ? listProducts(db, { series, finish, locale: req.locale, sort: 'sku' }) : [];
    if (space) products = products.filter((product) => SELECTOR_SPACES[space].includes(product.category_key));
    const spaceOptions = spaces.map((key) => ({
      key,
      label: key === 'hospitality' ? pc.spaceHospitality : key === 'residential' ? pc.spaceResidential : key === 'accessible' ? pc.spaceAccessible : pc.spaceCommercial,
    }));
    return sendPage(req, res, 'selector', {
      pc,
      space,
      series,
      finish,
      seriesOptions,
      finishes,
      spaceOptions,
      hasSelection,
      products,
      localSignal: pc.localSignal,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: `${pc.selectorKicker} | OLANG`,
      description: pc.selectorLede,
      pageType: 'selector',
      noindex: hasSelection,
      canonicalPath: `/${prefix}/selector`,
    });
  }));

  router.get(`/${prefix}/solutions`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.contentFor('solutions');
    const items = copy.items.map((item, index) => ({
      ...item,
      href: urlFor(req, `solutions/${SOLUTION_SLUGS[index] || item.slug}`),
      categories: (SOLUTION_CATEGORIES[SOLUTION_SLUGS[index]] || item.categories).flatMap((key) => (key === 'towel-bar' ? ['single-towel-bar', 'double-towel-bar'] : [key])),
    }));
    return sendPage(req, res, 'solutions', {
      copy,
      items,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'solutions',
      jsonLd: [{
        '@type': 'CollectionPage', name: copy.title, description: copy.metaDescription,
        url: `${config.siteUrl}/${prefix}/solutions`,
      }],
    });
  }));

  router.get(`/${prefix}/solutions/:slug`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('solutions');
    const canonicalIndex = SOLUTION_SLUGS.indexOf(String(req.params.slug));
    const item = copy.items.find((entry) => entry.slug === req.params.slug)
      || (canonicalIndex >= 0 ? copy.items[canonicalIndex] : null);
    if (!item) return notFound(req, res);
    const resolvedIndex = canonicalIndex >= 0 ? canonicalIndex : copy.items.indexOf(item);
    const canonicalSlug = SOLUTION_SLUGS[resolvedIndex] || item.slug;
    const categories = getAllCategories(db, req.locale);
    const wanted = (SOLUTION_CATEGORIES[canonicalSlug] || item.categories).flatMap((key) => (key === 'towel-bar' ? ['single-towel-bar', 'double-towel-bar'] : [key]));
    const categoryList = wanted.map((key) => categories.find((cat) => cat.key === key)).filter(Boolean);
    const products = listProducts(db, { locale: req.locale }).filter((product) => categoryList.some((cat) => cat.id === product.category_id));
    const related = copy.items.map((entry, index) => ({
      ...entry, href: urlFor(req, `solutions/${SOLUTION_SLUGS[index] || entry.slug}`),
    })).filter((entry, index) => index !== resolvedIndex);
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: copy.title, url: `/${prefix}/solutions` },
      { name: item.title, url: urlFor(req, `solutions/${canonicalSlug}`) },
    ];
    return sendPage(req, res, 'solution', {
      copy,
      item,
      products,
      categories: categoryList,
      related,
      breadcrumbs,
      urlFor: (path) => urlFor(req, path),
      routeUrl: urlFor(req, item.route === 'project' ? 'projects' : 'wholesale'),
    }, {
      title: `${item.title} | OLANG`,
      description: item.summary,
      pageType: 'solution',
      noindex: false,
      breadcrumbs,
      jsonLd: [serviceSchema(item.title, `/${prefix}/solutions/${item.slug}`, item.summary, req.market.name)],
    });
  }));

  router.get(`/${prefix}/customization`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.t.dict.pages.oem;
    const products = listProducts(db, { locale: req.locale });
    const categories = getAllCategories(db, req.locale);
    const series = getSeriesFacet(db);
    const selectedSku = safeQuery(req.query.sku, 40).toUpperCase();
    const requestedAudience = ['wholesale', 'hotel', 'oem', 'architect', 'other'].includes(String(req.query.audience)) ? String(req.query.audience) : '';
    const projectSlug = safeQuery(req.query.project, 120);
    const project = projectSlug ? db.prepare('SELECT slug, title, location, project_type FROM case_studies WHERE slug = ? AND published = 1').get(projectSlug) : null;
    const fallbackTitle = res.locals.cc.metaTitle || (req.locale === 'ja' ? 'カスタマイズ相談｜OLANG' : req.locale === 'de' ? 'Individualisierung | OLANG' : 'Customization | OLANG');
    return sendPage(req, res, 'customization', {
      copy,
      products,
      categories,
      series,
      selectedSku,
      initialAudience: project ? 'hotel' : requestedAudience || 'wholesale',
      initialStep: selectedSku ? 2 : 1,
      project,
      errorCode: typeof req.query.form_error === 'string' ? req.query.form_error.slice(0, 40) : '',
      urlFor: (path) => urlFor(req, path),
    }, {
      title: res.locals.cc.metaTitle || fallbackTitle,
      description: res.locals.cc.metaDescription || '',
      pageType: 'customization',
      jsonLd: [serviceSchema(copy.title || fallbackTitle, `/${prefix}/customization`, copy.lede || '', req.market.name)],
    });
  }));

  router.get(`/${prefix}/customization/success`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const request = getCustomizationByReference(req.app.locals.db, String(req.query.ref || ''));
    const copy = req.t.dict.pages.oem;
    return sendPage(req, res, 'customization-success', {
      copy,
      request,
      reference: request ? request.reference : '',
      noindex: true,
    }, {
      title: copy.successTitle || 'Customization request received | OLANG',
      description: copy.successText || 'The customization request was stored for review.',
      pageType: 'customization_success',
      noindex: true,
    });
  }));

  router.get(`/${prefix}/wholesale`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('wholesale');
    const products = listProducts(db, { locale: req.locale });
    return sendPage(req, res, 'wholesale', {
      copy,
      products,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'wholesale',
    });
  }));

  router.get(`/${prefix}/oem`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.contentFor('oem');
    return sendPage(req, res, 'oem', {
      copy,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'oem',
    });
  }));

  router.get(`/${prefix}/projects`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('projects');
    const products = listProducts(db, { locale: req.locale });
    const cases = db.prepare(`
      SELECT * FROM case_studies
      WHERE published = 1
      ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'company_published' THEN 1 ELSE 2 END, updated_at DESC
    `).all().map((entry) => ({
      ...entry,
      localizedSummary: req.locale === 'de' ? (entry.summary_de || entry.summary)
        : req.locale === 'ja' ? (entry.summary_ja || entry.summary)
          : req.locale === 'it' ? (entry.summary_it || entry.summary) : entry.summary,
      href: urlFor(req, `projects/${entry.slug}`),
    }));
    return sendPage(req, res, 'projects', {
      copy,
      products,
      cases,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'projects',
    });
  }));

  router.get(`/${prefix}/projects/:slug`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('projects');
    const entry = db.prepare('SELECT * FROM case_studies WHERE slug = ? AND published = 1').get(String(req.params.slug || ''));
    if (!entry) return notFound(req, res);
    const localizedSummary = req.locale === 'de' ? (entry.summary_de || entry.summary)
      : req.locale === 'ja' ? (entry.summary_ja || entry.summary)
        : req.locale === 'it' ? (entry.summary_it || entry.summary) : entry.summary;
    const description = req.locale === 'de' ? entry.description_de
      : req.locale === 'ja' ? entry.description_ja : entry.description_en;
    const projectCopy = req.t.dict.pages.projects;
    const candidateProducts = getMarketFeaturedProducts(db, req.market.code, req.locale, 4);
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: req.t.dict.footer.projects, url: `/${prefix}/projects` },
      { name: entry.title, url: req.path },
    ];
    return sendPage(req, res, 'project-detail', {
      copy,
      projectCopy,
      entry: { ...entry, localizedSummary, localizedDescription: description || localizedSummary },
      candidateProducts,
      breadcrumbs,
      urlFor: (target) => urlFor(req, target),
    }, {
      title: `${entry.title} | OLANG`,
      description: `${localizedSummary} ${projectCopy.detailMeta}`.slice(0, 300),
      pageType: 'project_detail',
      breadcrumbs,
      ogImage: entry.image_path ? absoluteImage(req, entry.image_path) : undefined,
      ogImageAlt: entry.title,
      jsonLd: [{
        '@type': 'WebPage',
        name: entry.title,
        description: localizedSummary,
        url: `${config.siteUrl}/${prefix}/projects/${entry.slug}`,
        inLanguage: req.market.htmlLang,
        isBasedOn: entry.source_url || undefined,
      }, breadcrumbList(breadcrumbs)],
    });
  }));

  router.get(`/${prefix}/about`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('about');
    const homeCopy = req.contentFor('home');
    return sendPage(req, res, 'about', {
      copy,
      stats: homeCopy.stats,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'about',
    });
  }));

  router.get(`/${prefix}/company`, (req, res) => res.redirect(301, `/${prefix}/about`));

  for (const pageKey of ['culture', 'development', 'honor', 'factory', 'quality']) {
    router.get(`/${prefix}/about/${pageKey}`, ctx, siteCtx, asyncHandler(async (req, res) => {
      const copy = companyPage(req.locale, pageKey);
      const breadcrumbs = [
        { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
        { name: req.t.dict.footer.about, url: `/${prefix}/about` },
        { name: copy.title, url: req.path },
      ];
      return sendPage(req, res, `company-${pageKey}`, {
        copy,
        breadcrumbs,
        companyCommon: companyCommon(req.locale),
        urlFor: (path) => urlFor(req, path),
      }, {
        title: copy.metaTitle,
        description: copy.lede,
        pageType: `company_${pageKey}`,
        breadcrumbs,
      });
    }));
  }

  router.get(`/${prefix}/news`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = companyPage(req.locale, 'news');
    const category = ['company', 'industry'].includes(String(req.query.category)) ? String(req.query.category) : '';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = listNews(db, { locale: req.locale, category, page, limit: 9 });
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: copy.title, url: `/${prefix}/news` },
    ];
    return sendPage(req, res, 'news', {
      copy,
      articles: result.rows,
      category,
      pagination: result,
      breadcrumbs,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: category === 'company' ? `${copy.company} | OLANG` : category === 'industry' ? `${copy.industry} | OLANG` : copy.metaTitle,
      description: copy.lede,
      pageType: 'news',
      breadcrumbs,
    });
  }));

  router.get(`/${prefix}/news/:slug`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = companyPage(req.locale, 'news');
    const article = getNewsBySlug(db, String(req.params.slug), req.locale);
    if (!article) return notFound(req, res);
    const related = relatedNews(db, article, req.locale, 3);
    const breadcrumbs = [
      { name: HOME_LABEL[req.locale] || 'Home', url: `/${prefix}` },
      { name: copy.title, url: `/${prefix}/news` },
      { name: article.title, url: req.path },
    ];
    return sendPage(req, res, 'news-article', {
      copy,
      article,
      related,
      breadcrumbs,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: `${article.title} | OLANG News`,
      description: article.excerpt,
      pageType: 'news_article',
      breadcrumbs,
      jsonLd: [{
        '@type': 'NewsArticle',
        headline: article.title,
        description: article.excerpt,
        datePublished: article.published_at,
        image: article.image_path ? absoluteImage(req, article.image_path) : undefined,
        publisher: { '@type': 'Organization', name: 'OLANG' },
      }],
    });
  }));

  router.get(`/${prefix}/resources`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.contentFor('resources');
    const filters = {
      type: DOC_TYPES.includes(String(req.query.type)) ? String(req.query.type) : '',
      q: safeQuery(req.query.q, 120),
      sku: safeQuery(req.query.product || req.query.sku, 40),
    };
    const documents = listDocuments(db, { ...filters, locale: req.locale, market: req.market.code });
    const products = listProducts(db, { locale: req.locale });
    const faqs = listFaqs(db, req.locale);
    const prefill = {
      sku: filters.sku,
      type: filters.type,
      market: req.market.code,
    };
    return sendPage(req, res, 'resources', {
      copy,
      documents,
      products,
      faqs,
      filters,
      prefill,
      documentTypeLabel: (type) => documentTypeLabel(type, req.locale),
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'resources',
      noindex: Boolean(filters.q || filters.type || filters.sku),
      canonicalPath: `/${prefix}/resources`,
    });
  }));

  router.get(`/${prefix}/contact`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.contentFor('contact');
    const requestedType = String(req.query.type || 'general');
    const defaultType = ['general', 'product_info', 'document_request', 'wholesale', 'oem', 'project'].includes(requestedType)
      ? requestedType : 'general';
    return sendPage(req, res, 'contact', {
      copy,
      defaultType,
      prefillSku: safeQuery(req.query.product || req.query.sku, 40),
      address: config.publicContact.address,
      mapUrl: `https://www.openstreetmap.org/search?query=${encodeURIComponent('Chancheng District, Foshan, Guangdong, China')}`,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'contact',
      jsonLd: [{
        '@type': 'ContactPage',
        name: copy.metaTitle,
        url: absolute(`/${prefix}/contact`),
        about: { '@id': `${config.siteUrl}/#organization` },
        mainEntity: {
          '@type': 'Organization',
          name: 'OLANG',
          legalName: config.publicContact.company,
          email: config.publicContact.email,
          telephone: config.publicContact.phone,
          url: config.siteUrl,
          address: {
            '@type': 'PostalAddress',
            streetAddress: config.publicContact.address.street,
            addressLocality: config.publicContact.address.city,
            addressRegion: config.publicContact.address.region,
            postalCode: config.publicContact.address.postalCode,
            addressCountry: config.publicContact.address.country,
          },
        },
      }],
    });
  }));

  router.get(`/${prefix}/privacy`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.t.dict.pages.privacy;
    const vars = {
      version: config.privacy.cookiePolicyVersion,
      inquiryMonths: config.privacy.inquiryRetentionMonths,
      uploadMonths: config.privacy.uploadRetentionMonths,
      analyticsDays: config.privacy.analyticsRetentionDays,
    };
    return sendPage(req, res, 'privacy', {
      copy,
      privacyVars: vars,
      fill,
      consent: res.locals.consent,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'privacy',
    });
  }));

  router.get(`/${prefix}/privacy/request`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.t.dict.pages.privacy;
    const reference = safeQuery(req.query.ref, 40);
    return sendPage(req, res, 'privacy-request', {
      copy,
      reference,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: `${copy.requestFormTitle} | OLANG`,
      description: copy.requestFormIntro,
      pageType: 'privacy_request',
      noindex: true,
    });
  }));

  router.get(`/${prefix}/legal`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const copy = req.t.dict.pages.legal;
    return sendPage(req, res, 'legal', {
      copy,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'legal',
    });
  }));

  router.get(`/${prefix}/compare`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.t.dict.pages.compare;
    const skus = String(req.query.skus || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
    const products = getProductsBySkus(db, skus, req.locale);
    const comparison = products.map((product) => ({
      product,
      rows: buildProcurementRows(product, req.market),
    }));
    return sendPage(req, res, 'compare', {
      copy,
      products,
      comparison,
      selectedSkus: skus,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'compare',
      noindex: true,
    });
  }));

  router.get(`/${prefix}/inquiry`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.t.dict.pages.inquiry;
    const products = listProducts(db, { locale: req.locale });
    return sendPage(req, res, 'inquiry', {
      copy,
      products,
      prefill: { series: safeQuery(req.query.series, 80) },
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'inquiry',
      noindex: true,
    });
  }));

  router.get(`/${prefix}/success`, ctx, siteCtx, asyncHandler(async (req, res) => {
    const db = req.app.locals.db;
    const copy = req.t.dict.pages.success;
    const reference = safeQuery(req.query.ref, 40);
    if (!/^OL-\d{6}-[A-Z0-9]{6}$/.test(reference)) return notFound(req, res);
    const inquiry = getInquiryByReference(db, reference);
    if (!inquiry) return notFound(req, res);
    const detail = getInquiryDetail(db, inquiry.id);
    const ack = detail.emails.filter((email) => email.kind === 'acknowledgement').slice(-1)[0];
    const emailStatus = ack ? ack.status : 'not_configured';
    return sendPage(req, res, 'success', {
      copy,
      inquiry: detail,
      emailStatus,
      formatDate,
      urlFor: (path) => urlFor(req, path),
    }, {
      title: copy.metaTitle,
      description: copy.metaDescription,
      pageType: 'success',
      noindex: true,
    });
  }));
}

router.use((req, res, next) => ctx(req, res, next));
router.use((req, res, next) => siteCtx(req, res, next));
router.use((req, res) => notFound(req, res));

module.exports = router;

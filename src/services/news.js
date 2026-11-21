'use strict';

const { localeFor } = require('./products');

function baseQuery() {
  return `
    SELECT n.id, n.slug, n.category, n.published_at, n.image_path, n.source_url,
           n.source_checked_at, n.sort_order,
           COALESCE(nt.title, nte.title) AS title,
           COALESCE(nt.excerpt, nte.excerpt) AS excerpt,
           COALESCE(nt.body, nte.body) AS body,
           COALESCE(nt.seo_title, nte.seo_title, '') AS seo_title,
           COALESCE(nt.seo_description, nte.seo_description, '') AS seo_description
    FROM news_articles n
    LEFT JOIN news_translations nt ON nt.article_id = n.id AND nt.locale = @locale
    LEFT JOIN news_translations nte ON nte.article_id = n.id AND nte.locale = 'en'
  `;
}

function listNews(db, options = {}) {
  const params = { locale: localeFor(options.locale || 'en') };
  const where = ['n.published = 1'];
  if (options.category === 'company' || options.category === 'industry') {
    where.push('n.category = @category');
    params.category = options.category;
  }
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
  const page = Math.max(1, Number(options.page) || 1);
  params.limit = limit;
  params.offset = (page - 1) * limit;
  const rows = db.prepare(`
    ${baseQuery()}
    WHERE ${where.join(' AND ')}
    ORDER BY n.published_at DESC, n.sort_order, n.id DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  const countParams = { ...params };
  delete countParams.limit;
  delete countParams.offset;
  delete countParams.locale;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM news_articles n WHERE ${where.join(' AND ')}`).get(countParams).c;
  return { rows, total, page, limit, pages: Math.ceil(total / limit) };
}

function getNewsBySlug(db, slug, locale = 'en') {
  return db.prepare(`
    ${baseQuery()}
    WHERE n.slug = @slug AND n.published = 1
  `).get({ slug, locale: localeFor(locale) });
}

function relatedNews(db, article, locale = 'en', limit = 3) {
  return db.prepare(`
    ${baseQuery()}
    WHERE n.published = 1 AND n.id <> @id
      AND (n.category = @category OR n.category = 'company')
    ORDER BY CASE WHEN n.category = @category THEN 0 ELSE 1 END, n.published_at DESC
    LIMIT @limit
  `).all({
    id: article.id, category: article.category, locale: localeFor(locale), limit,
  });
}

function newsCategories(db) {
  return db.prepare(`
    SELECT category, COUNT(*) AS count FROM news_articles WHERE published = 1 GROUP BY category
  `).all();
}

module.exports = { listNews, getNewsBySlug, relatedNews, newsCategories };

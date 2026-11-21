'use strict';

const { nowIso } = require('../lib/util');
const { transaction } = require('./index');
const { getSetting, setSetting } = require('../services/settings');
const editorial = require('./editorial.json');

const EDITORIAL_VERSION = '1';

function seedEditorial(db, log = console) {
  if (getSetting(db, 'editorial.version', '') === EDITORIAL_VERSION) return { skipped: true };
  transaction(db, () => {
    const now = nowIso();
    const upsertArticle = db.prepare(`
      INSERT INTO news_articles (
        slug, category, published_at, image_path, source_url, source_checked_at,
        published, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '2026-11-08', 1, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        category = excluded.category, published_at = excluded.published_at,
        image_path = excluded.image_path, source_url = excluded.source_url,
        published = 1, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `);
    const upsertTranslation = db.prepare(`
      INSERT INTO news_translations (
        article_id, locale, title, excerpt, body, seo_title, seo_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, locale) DO UPDATE SET
        title = excluded.title, excerpt = excluded.excerpt, body = excluded.body,
        seo_title = excluded.seo_title, seo_description = excluded.seo_description
    `);
    for (const article of editorial.news) {
      upsertArticle.run(
        article.slug, article.category, article.publishedAt, article.image,
        article.sourceUrl, article.sortOrder, now, now,
      );
      const row = db.prepare('SELECT id FROM news_articles WHERE slug = ?').get(article.slug);
      for (const locale of ['en', 'de', 'it']) {
        const translation = article.translations[locale];
        upsertTranslation.run(
          row.id, locale, translation.title, translation.excerpt, translation.body,
          `${translation.title} | OLANG News`, translation.excerpt.slice(0, 300),
        );
      }
    }

    const upsertCase = db.prepare(`
      INSERT INTO case_studies (
        slug, title, summary, summary_de, summary_it, market, location, project_type,
        products, year, image_path, source_url, verification_status,
        authorization_reference, authorization_confirmed, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'company_published', NULL, 0, 1, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title, summary = excluded.summary, summary_de = excluded.summary_de,
        summary_it = excluded.summary_it, market = excluded.market, location = excluded.location,
        project_type = excluded.project_type, image_path = excluded.image_path,
        source_url = excluded.source_url, published = 1, updated_at = excluded.updated_at
    `);
    for (const entry of editorial.cases) {
      upsertCase.run(
        entry.slug, entry.title, entry.summary, entry.summary_de, entry.summary_it,
        entry.market, entry.location, entry.projectType, entry.image,
        'https://en.olang.cn/cases.html', now, now,
      );
    }
    setSetting(db, 'editorial.version', EDITORIAL_VERSION);
  });
  log.info(`[editorial] seeded ${editorial.news.length} news articles and ${editorial.cases.length} company-published project references`);
  return { skipped: false };
}

module.exports = { seedEditorial, EDITORIAL_VERSION };

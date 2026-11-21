'use strict';

const { nowIso } = require('../lib/util');

function localeFor(locale) {
  return locale === 'de' || locale === 'it' || locale === 'ja' ? locale : 'en';
}

function listFaqs(db, locale = 'en', options = {}) {
  const lang = localeFor(locale);
  const published = options.includeUnpublished ? '' : 'AND q.published = 1';
  return db.prepare(`
    SELECT q.id, q.key, q.sort_order, q.published,
           COALESCE(t.question, te.question) AS question,
           COALESCE(t.answer, te.answer) AS answer,
           t.status AS translation_status
    FROM faqs q
    LEFT JOIN faq_translations t ON t.faq_id = q.id AND t.locale = ?
    LEFT JOIN faq_translations te ON te.faq_id = q.id AND te.locale = 'en'
    WHERE 1=1 ${published}
    ORDER BY q.sort_order, q.id
  `).all(lang);
}

function getFaq(db, id) {
  return db.prepare('SELECT * FROM faqs WHERE id = ?').get(id);
}

function getFaqTranslations(db, id) {
  return db.prepare('SELECT * FROM faq_translations WHERE faq_id = ?').all(id);
}

function updateFaq(db, id, data) {
  const now = nowIso();
  db.prepare('UPDATE faqs SET sort_order = ?, published = ?, updated_at = ? WHERE id = ?')
    .run(Number(data.sort_order) || 0, data.published ? 1 : 0, now, id);
  for (const locale of ['en', 'de', 'it', 'ja']) {
    const question = String(data[`question_${locale}`] || '').trim();
    const answer = String(data[`answer_${locale}`] || '').trim();
    const status = ['draft', 'ai_draft', 'reviewed', 'approved'].includes(data[`status_${locale}`])
      ? data[`status_${locale}`] : 'ai_draft';
    if (!question || !answer) {
      db.prepare('DELETE FROM faq_translations WHERE faq_id = ? AND locale = ?').run(id, locale);
      continue;
    }
    db.prepare(`
      INSERT INTO faq_translations (faq_id, locale, question, answer, status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(faq_id, locale) DO UPDATE SET
        question = excluded.question, answer = excluded.answer, status = excluded.status
    `).run(id, locale, question.slice(0, 500), answer.slice(0, 5000), status);
  }
}

function createFaq(db, data) {
  const now = nowIso();
  const key = String(data.key || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!key) throw new Error('FAQ key is required.');
  const info = db.prepare(`
    INSERT INTO faqs (key, sort_order, published, created_at, updated_at) VALUES (?, ?, 0, ?, ?)
  `).run(key, Number(data.sort_order) || 99, now, now);
  return Number(info.lastInsertRowid);
}

module.exports = { listFaqs, getFaq, getFaqTranslations, updateFaq, createFaq };

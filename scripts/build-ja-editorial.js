'use strict';

/**
 * Draft Japanese translations for the migrated news and FAQ records.
 * Committed output; no runtime translation service is used by the website.
 */
const fs = require('node:fs');
const path = require('node:path');
const editorial = require('./../src/db/editorial.json');
const { FAQS } = require('./../src/db/seed');

const NEWS_OUT = path.resolve(__dirname, '..', 'src', 'db', 'ja-editorial.json');
const FAQ_OUT = path.resolve(__dirname, '..', 'src', 'db', 'ja-faq.json');

async function translate(text) {
  if (!text) return text;
  const url = new URL('https://clients5.google.com/translate_a/t');
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'ja');
  url.searchParams.set('q', text);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 OLANG research' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const value = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0][0] : data[0]) : data;
      if (!value) throw new Error('empty translation');
      return String(value);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return text;
}

(async () => {
  const news = [];
  for (const article of editorial.news) {
    const t = article.translations.en;
    console.log('news', article.slug);
    news.push({
      slug: article.slug,
      title: await translate(t.title),
      excerpt: await translate(t.excerpt),
      body: await translate(t.body),
      seoTitle: await translate(`${t.title} | OLANG News`),
      seoDescription: await translate(t.excerpt.slice(0, 220)),
    });
    fs.writeFileSync(NEWS_OUT, JSON.stringify(news, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const faqs = [];
  for (const faq of FAQS) {
    console.log('faq', faq.key);
    faqs.push({
      key: faq.key,
      question: await translate(faq.en[0]),
      answer: await translate(faq.en[1]),
    });
    fs.writeFileSync(FAQ_OUT, JSON.stringify(faqs, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log('done', NEWS_OUT, FAQ_OUT);
})().catch((error) => { console.error(error); process.exitCode = 1; });

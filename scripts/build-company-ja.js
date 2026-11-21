'use strict';

const fs = require('node:fs');
const path = require('node:path');
const source = require('../src/content/company-pages').COMPANY_PAGES.en;

function isObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function leaves(v, p = '', out = []) {
  if (Array.isArray(v)) v.forEach((entry, i) => leaves(entry, `${p}.${i}`, out));
  else if (isObject(v)) for (const [k, val] of Object.entries(v)) leaves(val, p ? `${p}.${k}` : k, out);
  else if (typeof v === 'string') out.push([p, v]);
  return out;
}
function setPath(target, key, value) {
  const parts = key.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (cursor[part] === undefined) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}
async function translate(text) {
  const url = new URL('https://clients5.google.com/translate_a/t');
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'ja');
  url.searchParams.set('q', text);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 OLANG research' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const value = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0][0] : data[0]) : data;
      if (value) return String(value);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return text;
}
(async () => {
  const items = leaves(source);
  const cache = {};
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    const url = new URL('https://clients5.google.com/translate_a/t');
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', 'en');
    url.searchParams.set('tl', 'ja');
    for (const [, value] of batch) url.searchParams.append('q', value);
    let rows;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 OLANG research' }, signal: AbortSignal.timeout(45000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rows = await res.json();
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    batch.forEach(([key], index) => { cache[key] = Array.isArray(rows[index]) ? rows[index][0] : rows[index]; });
    console.log(`${i + batch.length}/${items.length}`);
  }
  const out = {};
  for (const [key, value] of items) setPath(out, key, cache[key] || value);
  // High-visibility labels and uncommon machine-translation artefacts.
  const fix = {
    'culture.kicker': '会社情報', 'culture.title': 'ものづくりの精度と、長く続くパートナーシップ。',
    'culture.lede': 'OLANGが公開しているミッション、ビジョン、価値観は、浴室金物の設計・製造・サービスへの姿勢を示しています。',
    'culture.backAbout': 'OLANGについて', 'development.kicker': '会社情報',
    'development.title': '浴室金物づくりの20年。', 'development.backAbout': 'OLANGについて',
    'honor.kicker': '会社情報', 'honor.title': 'OLANGが公開している表彰・資料。', 'honor.backAbout': 'OLANGについて',
    'factory.kicker': '会社情報', 'factory.title': '素材から、梱包された浴室金物まで。', 'factory.backAbout': 'OLANGについて',
    'quality.kicker': '会社情報', 'quality.title': '素材受入から出荷までの品質確認。', 'quality.backAbout': 'OLANGについて',
    'news.kicker': 'ニュース', 'news.title': '企業情報と業界のトピック。', 'news.readMore': '記事を読む',
    'news.backNews': 'ニュース一覧', 'news.source': '原典',
    'common.company': '会社情報', 'common.about': 'OLANGについて', 'common.culture': '企業文化',
    'common.development': '沿革', 'common.honor': '受賞・認証', 'common.news': 'ニュース',
    'common.factory': '工場', 'common.quality': '品質', 'common.process': 'カスタマイズの流れ',
    'common.contact': 'カスタマイズ窓口', 'common.catalogue': '製品カタログ',
  };
  for (const [key, value] of Object.entries(fix)) setPath(out, key, value);
  const file = path.resolve(__dirname, '..', 'src', 'content', 'company-pages-ja.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('wrote', file);
})().catch((e) => { console.error(e); process.exitCode = 1; });

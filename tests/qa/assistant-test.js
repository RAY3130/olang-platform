'use strict';

/**
 * Multilingual grounded-assistant test set.
 *
 * The checks assert observable facts: the answer language, whether a source is
 * returned, whether the expected published value/intent appears and whether a
 * forbidden fabricated commercial value is present. The judgement is scripted,
 * not a native-speaker evaluation.
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const OUT = path.resolve(__dirname, '..', '..', '..', 'deliverables', '06_Website_QA');
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { id: 'EN-P01', market: 'en-gb', lang: 'en', group: 'product lookup', q: 'Tell me about OL-1204', expectIntent: 'product', expect: [/Robe Hook/, /1200 Series/], mustNot: [/USD|MOQ is \d|lead time is \d/i], source: true },
  { id: 'EN-P02', market: 'en-gb', lang: 'en', group: 'product parameters', q: 'What finishes does OL-1204 have?', expectIntent: 'product_attribute', expect: [/Chrome/, /Brushed Gold/], mustNot: [/thickness is|CE certified/i], source: true },
  { id: 'EN-P03', market: 'en-gb', lang: 'en', group: 'comparison', q: 'Compare OL-1204 and OL-1205', expectIntent: 'comparison', expect: [/OL-1204/, /OL-1205/, /55 × 55 × 70 mm|Specification|Dimensions/], mustNot: [/price|MOQ/i], source: true },
  { id: 'EN-P04', market: 'en-gb', lang: 'en', group: 'MOQ', q: 'What is the MOQ for OL-1204?', expectIntent: 'product_attribute', expect: [/No verified MOQ|not published/i], mustNot: [/200|300/], source: true },
  { id: 'EN-P05', market: 'en-gb', lang: 'en', group: 'lead time', q: 'What is the lead time?', expectIntent: 'faq', expect: [/not published|on request|confirm/i], mustNot: [/\b25\b|\b35\b/], source: true },
  { id: 'EN-P06', market: 'en-gb', lang: 'en', group: 'certification', q: 'Are your products UKCA certified?', expectIntent: 'faq', expect: [/not.*blanket|no blanket|certification|document/i], mustNot: [/we are UKCA certified/i], source: true },
  { id: 'EN-P07', market: 'en-gb', lang: 'en', group: 'customization', q: 'How does OEM customization work?', expectIntent: 'page', expect: [/OEM|ODM|custom/i], mustNot: [/all changes are possible/i], source: true },
  { id: 'EN-P08', market: 'en-gb', lang: 'en', group: 'no data / ambiguous', q: 'Do you have a showroom in London?', expectIntent: 'fallback', expect: [/cannot confirm|send an inquiry/i], mustNot: [/yes, we have/i], source: false },
  { id: 'EN-P09', market: 'en-gb', lang: 'en', group: 'documents', q: 'Can I download the dimension drawing?', expectIntent: 'page', expect: [/document|request|SKU/i], mustNot: [/download here/i], source: true },
  { id: 'EN-P10', market: 'en-gb', lang: 'en', group: 'human handoff', q: 'I need to speak to a salesperson', expectIntent: 'handoff', expect: [/contact|inquiry|team/i], mustNot: [], source: true },

  { id: 'DE-P01', market: 'de', lang: 'de', group: 'product lookup', q: 'Erzählen Sie mir etwas über OL-1204', expectIntent: 'product', expect: [/Bademantelhaken|OL-1204/], mustNot: [/Preis|MOQ von \d/i], source: true },
  { id: 'DE-P02', market: 'de', lang: 'de', group: 'product parameters', q: 'Welche Oberflächen hat OL-1204?', expectIntent: 'product_attribute', expect: [/Oberflächen|Chrome/], mustNot: [/CE-zertifiziert/i], source: true },
  { id: 'DE-P03', market: 'de', lang: 'de', group: 'comparison', q: 'Vergleiche OL-1204 und OL-1205', expectIntent: 'comparison', expect: [/OL-1204/, /OL-1205/, /55 × 55 × 70 mm|Spezifikation|Maße/], mustNot: [/Preis pro Stück/i], source: true },
  { id: 'DE-P04', market: 'de', lang: 'de', group: 'MOQ', q: 'Wie hoch ist die Mindestbestellmenge?', expectIntent: 'faq', expect: [/Mindestmenge|MOQ/], mustNot: [/\b200\b|\b300\b/], source: true },
  { id: 'DE-P05', market: 'de', lang: 'de', group: 'certification', q: 'Welche Zertifikate haben Sie?', expectIntent: 'faq', expect: [/Zertifiz|Dokument|CE/], mustNot: [/Wir sind zertifiziert/i], source: true },
  { id: 'DE-P06', market: 'de', lang: 'de', group: 'customization', q: 'Wie funktioniert die Individualisierung?', expectIntent: 'page', expect: [/OEM|ODM|Individual/i], mustNot: [/alle Änderungen sind möglich/i], source: true },
  { id: 'DE-P07', market: 'de', lang: 'de', group: 'no data', q: 'Haben Sie ein Büro in Berlin?', expectIntent: 'fallback', expect: [/nicht bestätigen|Anfrage/i], mustNot: [/Ja, wir haben/i], source: false },

  { id: 'JA-P01', market: 'ja-jp', lang: 'ja', group: 'product lookup', q: 'OL-1204について教えてください', expectIntent: 'product', expect: [/ローブフック|OL-1204/], mustNot: [/価格は\d|MOQは\d/i], source: true },
  { id: 'JA-P02', market: 'ja-jp', lang: 'ja', group: 'product parameters', q: 'OL-1204の仕上げは？', expectIntent: 'product_attribute', expect: [/クローム|ヘアラインゴールド/], mustNot: [/UKCA認証済み/i], source: true },
  { id: 'JA-P03', market: 'ja-jp', lang: 'ja', group: 'comparison', q: 'OL-1204とOL-1205を比較してください', expectIntent: 'comparison', expect: [/OL-1204/, /OL-1205/, /お問い合わせください/], mustNot: [/価格は|MOQは\d/i], source: true },
  { id: 'JA-P04', market: 'ja-jp', lang: 'ja', group: 'MOQ', q: 'MOQはいくつですか？', expectIntent: 'faq', expect: [/MOQ|公開されていません/], mustNot: [/200|300/], source: true },
  { id: 'JA-P05', market: 'ja-jp', lang: 'ja', group: 'lead time', q: '納期はどのくらいですか？', expectIntent: 'faq', expect: [/公開されていない|お問い合わせ|確認/], mustNot: [/25日|35日/], source: true },
  { id: 'JA-P06', market: 'ja-jp', lang: 'ja', group: 'certification', q: '認証はありますか？', expectIntent: 'faq', expect: [/認証|適合|資料|包括/], mustNot: [/認証取得済みです/i], source: true },
  { id: 'JA-P07', market: 'ja-jp', lang: 'ja', group: 'customization', q: 'OEMの相談方法を教えてください', expectIntent: 'page', expect: [/OEM|カスタマイズ|ご相談/], mustNot: [/すべての変更が可能です/], source: true },
  { id: 'JA-P08', market: 'ja-jp', lang: 'ja', group: 'no data / ambiguous', q: '大阪にショールームはありますか？', expectIntent: 'fallback', expect: [/確認できません|お問い合わせ/], mustNot: [/はい、あります/i], source: false },
  { id: 'JA-P09', market: 'ja-jp', lang: 'ja', group: 'materials', q: '材質を教えてください', expectIntent: 'page', expect: [/材質|確認|お問い合わせ/], mustNot: [/真鍮H59|SUS304/i], source: true },
  { id: 'JA-P10', market: 'ja-jp', lang: 'ja', group: 'human handoff', q: '担当者と話したい', expectIntent: 'handoff', expect: [/担当者|お問い合わせ|フォーム/], mustNot: [], source: true },
];

const FORBIDDEN_ANY_LANGUAGE = [
  /USD\s?2\.20/i, /4\.60/, /25.?35\s?(days|日|Tage)/i, /200.?300\s?(pcs|個|Stück)/i,
  /H59/, /stainless steel 304/i, /認証取得済み/i, /UKCA certified/i,
];

async function ask(market, question) {
  const response = await fetch(`${BASE}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ market, question }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function hasJapanese(text) { return /[\u3040-\u30ff\u3400-\u9fff]/.test(text); }

(async () => {
  const rows = [];
  for (const item of CASES) {
    const started = Date.now();
    const result = await ask(item.market, item.q);
    const answer = String(result.answer || '');
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const failures = [];
    for (const pattern of item.expect) if (!pattern.test(answer)) failures.push(`missing ${pattern}`);
    for (const pattern of item.mustNot) if (pattern.test(answer)) failures.push(`forbidden ${pattern}`);
    for (const pattern of FORBIDDEN_ANY_LANGUAGE) if (pattern.test(answer)) failures.push(`fabricated value ${pattern}`);
    if (item.source && !sources.length) failures.push('no source');
    if (item.lang === 'ja' && !hasJapanese(answer)) failures.push('not Japanese');
    if (item.lang === 'de' && !/[äöüß]|der|die|das|Sie/.test(answer)) failures.push('not German');
    if (item.expectIntent && result.matched_type !== item.expectIntent) failures.push(`intent ${result.matched_type} != ${item.expectIntent}`);
    rows.push({
      id: item.id, market: item.market, language: item.lang, group: item.group, question: item.q,
      expected_intent: item.expectIntent, matched_type: result.matched_type || null,
      matched_ref: result.matched_ref || null, answer, sources: sources.map((source) => source.url).join(' | '),
      source_count: sources.length, pass: failures.length === 0, failures: failures.join('; '),
      latency_ms: Date.now() - started,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const passed = rows.filter((row) => row.pass).length;
  const output = {
    generated_at: new Date().toISOString(),
    base: BASE,
    method: 'Scripted API test of the grounded retrieval assistant. No human participants. Automated string checks only.',
    total: rows.length,
    passed,
    failed: rows.length - passed,
    accuracy: Number((passed / rows.length).toFixed(3)),
    limitations: [
      'Automated expectations are not a native-speaker quality review.',
      'No live LLM provider is configured; responses are from the approved rule/retrieval layer.',
      'A pass means that the required source/answer behaviour was observed for this question, not that the overall conversation is production-ready.',
    ],
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'assistant-tests.json'), JSON.stringify(output, null, 2));
  const csv = ['id,market,group,question,expected_intent,matched_type,pass,failures,source_count,latency_ms'];
  for (const row of rows) {
    const cell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    csv.push([row.id, row.market, row.group, row.question, row.expected_intent, row.matched_type, row.pass, row.failures, row.source_count, row.latency_ms].map(cell).join(','));
  }
  fs.writeFileSync(path.join(OUT, 'assistant-tests.csv'), csv.join('\n'), 'utf8');
  console.log(JSON.stringify({ total: output.total, passed, failed: output.failed, accuracy: output.accuracy }));
  for (const row of rows.filter((entry) => !entry.pass)) console.log('FAIL', row.id, row.failures, '|', row.answer.slice(0, 120));
})().catch((error) => { console.error(error); process.exitCode = 1; });

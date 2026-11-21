'use strict';

/**
 * Read the built report back and assert the release rules that can be checked mechanically:
 * forbidden phrasing, defensive sentences, repeated judgements, and numeric agreement with
 * metrics.json. The page count is estimated from the character count because Word is the only
 * renderer available on this machine.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCX = path.resolve(ROOT, '..', 'deliverables', '01_Report', 'OLANG_项目报告_v5.docx');
const METRICS = JSON.parse(fs.readFileSync(path.resolve(ROOT, '..', 'deliverables', '01_Report', 'metrics.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'olang-report-'));
const zipPath = path.join(tmp, 'report.zip');
fs.copyFileSync(DOCX, zipPath);
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`], { stdio: 'ignore' });

const xml = fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
const paragraphs = xml.split(/<w:p[ >]/).slice(1).map((chunk) => {
  const texts = [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]);
  return texts.join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}).filter((line) => line.trim());
const full = paragraphs.join('\n');
const bodyText = paragraphs.filter((line) => !/^(表|图|来源)/.test(line)).join('\n');

const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

function countOf(pattern) {
  return (full.match(pattern) || []).length;
}

// 1. Forbidden constructions
const forbidden = [
  ['不是…而是', /不是[^。]{0,40}而是/g],
  ['不把…写成', /不把[^。]{0,40}写成/g],
  ['不得', /不得/g],
  ['不能', /不能/g],
  ['不再', /不再/g],
  ['并未', /并未/g],
  ['没有…没有…没有', /没有[^。]{0,20}没有[^。]{0,20}没有/g],
];
for (const [label, pattern] of forbidden) {
  const hits = countOf(pattern);
  record(`phrase: ${label}`, hits === 0, `${hits} occurrences`);
}

// 2. Negation budget (allowed only in the limitations paragraph)
// Only negated predicates count; 不同/不仅/无论 are ordinary words.
const negation = (bodyText.match(/(不是|不能|不得|不再|并未|没有|未获取|尚未|未做)/g) || []).length;
record('negation density stays low', negation <= 10, `${negation} negated predicates`);

// 3. Numbers agree with metrics.json
const expectations = [
  ['123 个已发布型号', String(METRICS.catalogue.products)],
  ['282 条颜色', String(METRICS.colours.finishRows)],
  ['156 条有逐色实拍', String(METRICS.colours.finishRowsWithPhoto)],
  ['attributes total', String(METRICS.attributes.total)],
  ['981 条事件', String(METRICS.analytics.events)],
  ['375 条文档', String(METRICS.documents.total)],
  ['assets with geometry', String(METRICS.images.withGeometry)],
];
for (const [label, value] of expectations) {
  const plain = value.replace(/,/g, '');
  const haystack = full.replace(/,/g, '');
  record(`number ${label}`, haystack.includes(plain), `looking for ${value}`);
}

// 4. AI boundary statement must exist verbatim
record('AI boundary statement present',
  full.includes('选题、目标定位、策略框架、转化路径设计由团队完成，AI 仅用于内容生产与实现。'),
  'missing');

// 5. No claim of deployment, authorisation or成交
for (const word of ['已上线', '已获企业授权', '已成交', '已签约']) {
  record(`no claim: ${word}`, !full.includes(word), 'found');
}

// 6. Page estimate.
// A character count alone overstates a document with figures and tables, so the model below adds
// the space each block really takes on A4 with 2.25 cm margins: 1,900 characters per page of prose,
// 43 lines per page, about 6 cm per figure and 1.15 lines per table row.
const totalChars = full.replace(/\s+/g, '').length;
const bodyChars = bodyText.replace(/\s+/g, '').length;
const figureCount = (xml.match(/<w:drawing>/g) || []).length;
const tableRows = (xml.match(/<w:tr[ >]/g) || []).length;
const headings = (xml.match(/<w:pStyle w:val="Heading[12]"/g) || []).length;
const prosePages = bodyChars / 1900;
const tablePages = (tableRows * 1.15) / 43;
const figurePages = (figureCount * 6.2) / 25.2;
const headingPages = headings * 0.05;
const estimatedPages = Number((prosePages + tablePages + figurePages + headingPages).toFixed(1));
record('body length within the 10-page budget', estimatedPages <= 10,
  `${bodyChars} chars, ${tableRows} table rows, ${figureCount} figures, ${headings} headings ≈ ${estimatedPages} pages`);

console.log(JSON.stringify({
  file: path.relative(process.cwd(), DOCX),
  paragraphs: paragraphs.length,
  figureCount,
  tableRows,
  headings,
  totalChars,
  bodyChars,
  estimatedPages,
  checks: checks.length,
  passed: checks.filter((check) => check.ok).length,
  failed: checks.filter((check) => !check.ok),
}, null, 2));

fs.rmSync(tmp, { recursive: true, force: true });
if (checks.some((check) => !check.ok)) process.exitCode = 1;

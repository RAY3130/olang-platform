'use strict';

/*
 * Crawl-level check for the public site. Starts a disposable server and verifies
 * page metadata, JSON-LD, links, image alt text and template leaks. This is not
 * a substitute for the integration or browser suites.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'olang-check-'));
const PORT = Number(process.env.CHECK_PORT || 4200);
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = path.resolve(ROOT, '..', 'analysis', 'v2');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const env = {
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  SITE_MODE: 'demo',
  SITE_URL: BASE,
  DB_PATH: path.join(TEST_ROOT, 'check.sqlite'),
  UPLOAD_DIR: path.join(TEST_ROOT, 'uploads'),
  ADMIN_INITIAL_PASSWORD: 'TestAdmin!2026secure',
  EMAIL_TRANSPORT: 'outbox',
  SESSION_COOKIE_SECURE: '0',
};

const pages = [
  '/en', '/en-us', '/en-au', '/en-gb', '/de', '/it',
  '/en/products', '/de/products', '/en/products/robe-hook-ol-1204', '/de/products/robe-hook-ol-1204',
  '/en/solutions', '/en/solutions/hospitality-bathrooms', '/en/solutions/residential-bathrooms',
  '/en/solutions/commercial-washrooms', '/en/solutions/bathroom-renovation', '/en/solutions/distributor-assortment',
  '/en/wholesale', '/en/oem', '/en/projects', '/en/news', '/en/news/kbc-2026-shanghai-review',
  '/en/about', '/en/about/culture', '/en/about/development', '/en/about/honor', '/en/resources', '/en/contact',
  '/en/privacy', '/en/privacy/request', '/en/legal', '/en/compare?skus=OL-1204,OL-1205', '/en/inquiry',
  '/de/news', '/it/projects', '/de/about/honor', '/it/about/culture',
];

const FORBIDDEN_PUBLIC_COPY = [
  /AI Agent/i,
  /\bprompt\b/i,
  /academic prototype/i,
  /demonstration build/i,
  /not the official OLANG website/i,
  /course project/i,
  /No commercial use/i,
  /课程/,
  /提示词/,
  /待 AI/,
  /系统指令/,
];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer() {
  for (let i = 0; i < 75; i += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch (_) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('Check server did not start.');
}

function attrs(html, tagPattern) {
  const out = [];
  const regex = new RegExp(tagPattern, 'gi');
  let match;
  while ((match = regex.exec(html))) out.push(match[0]);
  return out;
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
  const issues = [];
  const records = [];
  const forbidden = ['demonstration environment','this test environment','not the official','before public launch','before production launch','AI Agent','修改要求','TODO','FIXME'];

  try {
    await waitForServer();
    for (const page of pages) {
      const response = await fetch(BASE + page);
      const html = await response.text();
      const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const description = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '';
      const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/i) || [])[1] || '';
      const h1s = (html.match(/<h1\b/gi) || []).length;
      const jsonLd = (html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i) || [])[1];
      const images = attrs(html, '<img\\b[^>]*>');
      const imagesWithoutAlt = images.filter((tag) => !/\balt=/.test(tag));
      const internalLinks = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((match) => match[1]);
      records.push({ page, status: response.status, bytes: Buffer.byteLength(html), h1s, title, description, canonical, jsonLd: Boolean(jsonLd), images: images.length, internalLinks: internalLinks.length });
      if (response.status !== 200) issues.push({ page, type: 'status', value: response.status });
      if (!title.trim()) issues.push({ page, type: 'missing_title' });
      if (!description.trim()) issues.push({ page, type: 'missing_description' });
      if (!canonical) issues.push({ page, type: 'missing_canonical' });
      if (h1s !== 1) issues.push({ page, type: 'h1_count', value: h1s });
      if (!jsonLd) issues.push({ page, type: 'missing_jsonld' });
      else {
        try { JSON.parse(jsonLd); } catch (error) { issues.push({ page, type: 'invalid_jsonld', value: error.message }); }
      }
      if (imagesWithoutAlt.length) issues.push({ page, type: 'image_missing_alt', value: imagesWithoutAlt.length });
      if (/\[object Promise\]/.test(html)) issues.push({ page, type: 'template_promise_leak' });
      for (const phrase of forbidden) { if (html.toLowerCase().includes(phrase.toLowerCase())) issues.push({ page, type: 'prompt_or_dev_copy', value: phrase }); }
      if (/\b(undefined|NaN)\b/.test(html.replace(/<script[\s\S]*?<\/script>/gi, ''))) issues.push({ page, type: 'template_value_leak' });
      if (!/<html[^>]+lang="/i.test(html)) issues.push({ page, type: 'missing_html_lang' });
      if (!/hreflang="x-default"/i.test(html) && !page.includes('compare') && !page.includes('inquiry') && !page.includes('privacy/request')) {
        issues.push({ page, type: 'missing_x_default' });
      }
      const visibleText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      for (const pattern of FORBIDDEN_PUBLIC_COPY) {
        if (pattern.test(visibleText)) issues.push({ page, type: 'forbidden_public_copy', value: String(pattern) });
      }
    }

    // Check a representative set of internal links (deduplicated), including
    // public pages and assets. A 301 is followed once; 404 is a failure.
    const linkSet = new Set(['/en', '/en/products', '/en/resources', '/en/privacy', '/assets/main.css', '/assets/site.js', '/robots.txt', '/sitemap.xml']);
    for (const record of records) {
      const response = await fetch(BASE + record.page);
      const html = await response.text();
      for (const match of html.matchAll(/href="(\/[^"#?]+)[^"]*"/g)) {
        if (!match[1].startsWith('/admin') && !match[1].startsWith('/api')) linkSet.add(match[1]);
      }
    }
    for (const link of linkSet) {
      const response = await fetch(BASE + link, { redirect: 'manual' });
      if (response.status >= 400 || response.status === 0) {
        issues.push({ page: link, type: 'broken_internal_link', value: response.status });
      }
    }
    const out = { base: BASE, checkedAt: new Date().toISOString(), pages: records.length, links: linkSet.size, issues, records };
    fs.writeFileSync(path.join(ARTIFACTS, 'link-check.json'), JSON.stringify(out, null, 2));
    console.log(`Checked ${records.length} pages and ${linkSet.size} internal links. Issues: ${issues.length}`);
    for (const issue of issues.slice(0, 30)) console.log(`${issue.type} ${issue.page} ${issue.value || ''}`);
    if (issues.length) process.exitCode = 1;
  } finally {
    child.kill();
    try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

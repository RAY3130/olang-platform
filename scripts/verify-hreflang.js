'use strict';

/**
 * hreflang audit.
 *
 * Every page must declare the same seven alternates plus an x-default that points at the /en
 * edition. Locally the host is 127.0.0.1, which is acceptable only in a development build: in
 * production a loopback host in an hreflang URL means the deployment was forgotten.
 *
 * Usage:
 *   node scripts/verify-hreflang.js                    # scan a sample of pages
 *   node scripts/verify-hreflang.js --all              # scan every sitemap URL
 *   node scripts/verify-hreflang.js --base https://example.com --production
 */

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : (process.env.SITE_URL || 'http://127.0.0.1:4174');
const ALL = argv.includes('--all');
const PRODUCTION = argv.includes('--production')
  || process.env.NODE_ENV === 'production'
  || process.env.SITE_MODE === 'production';

const EXPECTED = ['en', 'en-US', 'en-AU', 'en-GB', 'de-DE', 'it-IT', 'x-default'];
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i;

const SAMPLE_PATHS = ['/en', '/en/products', '/en/contact'];

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return null; }
}

async function fetchText(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, body: await res.text() };
}

function alternates(html) {
  const found = [];
  for (const match of html.matchAll(/<link[^>]+rel="alternate"[^>]*>/g)) {
    const tag = match[0];
    const hreflang = /hreflang="([^"]+)"/.exec(tag);
    const href = /href="([^"]+)"/.exec(tag);
    if (hreflang && href) found.push({ hreflang: hreflang[1], href: href[1] });
  }
  return found;
}

async function sitemapPaths() {
  const sitemap = await fetchText('/sitemap.xml');
  const locs = [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const paths = [];
  for (const loc of locs) {
    try {
      const url = new URL(loc);
      if (url.host === hostOf(BASE)) paths.push(url.pathname);
    } catch (_) { /* ignore */ }
  }
  return [...new Set(paths)];
}

async function main() {
  const failures = [];
  const baseHost = hostOf(BASE);
  if (PRODUCTION && LOOPBACK.test(BASE)) {
    failures.push(`production run pointed at a loopback host: ${BASE}`);
  }

  const paths = ALL ? await sitemapPaths() : SAMPLE_PATHS;
  let pagesChecked = 0;
  let alternatesSeen = 0;

  for (const pathname of paths) {
    const page = await fetchText(pathname);
    if (page.status !== 200) { failures.push(`${pathname} returned ${page.status}`); continue; }
    pagesChecked += 1;

    const links = alternates(page.body);
    alternatesSeen += links.length;
    const seen = links.map((link) => link.hreflang);
    const missing = EXPECTED.filter((code) => !seen.includes(code));
    if (missing.length) failures.push(`${pathname} is missing hreflang: ${missing.join(', ')}`);
    const extra = seen.filter((code) => !EXPECTED.includes(code));
    if (extra.length) failures.push(`${pathname} declares unexpected hreflang: ${extra.join(', ')}`);

    const xDefault = links.find((link) => link.hreflang === 'x-default');
    if (xDefault) {
      const path = new URL(xDefault.href).pathname;
      if (!/^\/en(\/|$)/.test(path)) failures.push(`${pathname} x-default does not point at /en: ${xDefault.href}`);
    }

    for (const link of links) {
      const host = hostOf(link.href);
      if (!host) { failures.push(`${pathname} has an unparsable href: ${link.href}`); continue; }
      if (host !== baseHost) failures.push(`${pathname} alternate host ${host} differs from ${baseHost}`);
      if (PRODUCTION && LOOPBACK.test(link.href)) {
        failures.push(`${pathname} keeps a loopback hreflang in production: ${link.href}`);
      }
      if (!PRODUCTION && !LOOPBACK.test(link.href)) {
        failures.push(`${pathname} uses a non-local hreflang in a local build: ${link.href}`);
      }
    }
  }

  console.log(`base ${BASE} (${PRODUCTION ? 'production' : 'local'} mode)`);
  console.log(`pages checked: ${pagesChecked} · alternate links: ${alternatesSeen}`);
  if (failures.length) {
    for (const failure of failures) console.log('FAIL  ' + failure);
    console.log(`hreflang audit failed: ${failures.length} problems`);
    process.exitCode = 1;
    return;
  }
  console.log(`hreflang audit passed: ${EXPECTED.length} alternate codes on every page, x-default -> /en`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

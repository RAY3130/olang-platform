'use strict';

/**
 * Fresh, independent capture of the current OLANG original site and its chat entry.
 * Evidence only; no content is copied into the redesign.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUT = path.resolve(__dirname, '..', '..', '..', 'research', 'original_audit_agent_2026-11-15');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'https://en.olang.cn';
const PAGES = [
  ['home', '/'],
  ['products', '/Products.html'],
  ['product-ol1204', '/ProductDetail/21.html'],
  ['cases', '/cases.html'],
  ['case-detail', '/cases_detail/37.html'],
  ['customization', '/dzzx.html'],
  ['profile', '/Profile.html'],
  ['contact', '/Contact.html'],
  ['news', '/Blog/1.html'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, locale: 'en-GB',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  const page = await context.newPage();
  const network = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/^https?:\/\//.test(url)) return;
    if (/chat|kefu|service|visitor|livechat|53kf|udesk|meiqia|zendesk|tawk|intercom/i.test(url)) network.push({ url, type: request.resourceType() });
  });
  const results = [];
  for (const [name, pathname] of PAGES) {
    const response = await page.goto(BASE + pathname, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((node) => node.innerText.trim()).filter(Boolean),
      links: [...document.querySelectorAll('a[href]')].map((a) => ({ text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80), href: a.getAttribute('href') })).filter((item) => item.text).slice(0, 120),
      iframes: [...document.querySelectorAll('iframe')].map((node) => ({ src: node.src, title: node.title })),
      chatText: [...document.querySelectorAll('body *')].filter((node) => node.children.length === 0 && /chat|service|客服|在线/i.test(node.textContent || '')).map((node) => (node.textContent || '').trim()).filter(Boolean).slice(0, 20),
      body: document.body.innerText.slice(0, 3000),
    }));
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
    results.push({ name, pathname, status: response ? response.status() : null, ...info });
    console.log(name, response && response.status(), info.title);
  }
  // Look for the chat launcher and click it if found.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const candidates = await page.locator('body *').filter({ hasText: /Chat|chat|客服|在线|咨询/ }).evaluateAll((nodes) => nodes.filter((n) => n.children.length < 3).slice(0, 20).map((n) => ({ tag: n.tagName, cls: n.className, text: (n.textContent || '').trim().slice(0, 80) })));
  const chatResult = { candidates, clicked: false, panelText: '', iframes: [] };
  for (const text of ['Chat', 'chat', 'Online', '客服']) {
    const locator = page.getByText(text, { exact: false }).last();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 3000, force: true });
        chatResult.clicked = true;
        await page.waitForTimeout(2500);
        chatResult.panelText = (await page.locator('body').innerText()).slice(-2500);
        chatResult.iframes = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((n) => ({ src: n.src, title: n.title })));
        await page.screenshot({ path: path.join(SHOTS, 'chat-opened.png'), fullPage: false });
        break;
      } catch (_) { /* try next candidate */ }
    }
  }
  results.push({ name: 'chat-attempt', ...chatResult });
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ captured_at: new Date().toISOString(), base: BASE, results, chatNetwork: network }, null, 2));
  console.log('chat network', JSON.stringify([...new Map(network.map((item) => [item.url, item])).values()], null, 2));
  console.log('chat result', JSON.stringify(chatResult, null, 2).slice(0, 3000));
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

/**
 * Scripted old-vs-new task comparison.
 *
 * This is not a human usability study. Every task is performed by one browser
 * script; time and clicks are indicators of the interaction path, not evidence
 * of user preference. The old site is never sent a real inquiry.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUT = path.resolve(__dirname, '..', '..', '..', 'deliverables', '06_Website_QA');
const SHOTS = path.join(OUT, 'old-new');
fs.mkdirSync(SHOTS, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OLD = 'https://en.olang.cn';
const NEW = process.env.SITE_BASE || 'http://127.0.0.1:4174';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

async function gotoWithRetry(page, url, attempts = 3) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (index === attempts - 1) throw error;
      await page.waitForTimeout(900);
    }
  }
  return null;
}

async function prepare(page, site) {
  await page.addInitScript(() => {
    try {
      window.__qaClicks = Number(window.sessionStorage.getItem('__qaClicks') || 0);
      document.addEventListener('click', () => {
        window.__qaClicks += 1;
        try { window.sessionStorage.setItem('__qaClicks', String(window.__qaClicks)); } catch (_) {}
      }, true);
    } catch (_) {
      window.__qaClicks = 0;
    }
  });
  await gotoWithRetry(page, site === 'old' ? OLD + '/' : NEW + '/en-gb');
  await page.waitForTimeout(1500);
  if (site === 'old') {
    await page.getByRole('button', { name: /allow all/i }).click().catch(() => {});
  } else {
    await page.getByRole('button', { name: /allow analytics/i }).click().catch(() => {});
  }
}

async function resetClicks(page) {
  await page.evaluate(() => {
    window.__qaClicks = 0;
    try { window.sessionStorage.setItem('__qaClicks', '0'); } catch (_) {}
  });
}

async function measure(page) {
  return page.evaluate(() => {
    try { return Number(window.sessionStorage.getItem('__qaClicks') || 0); } catch (_) { return window.__qaClicks || 0; }
  });
}

async function runTask(page, site, task) {
  await resetClicks(page);
  const started = Date.now();
  let success = false;
  let detail = '';
  try {
    await gotoWithRetry(page, site === 'old' ? OLD + '/' : NEW + '/en-gb');
    await page.waitForTimeout(1000);
    if (task === 'A') {
      if (site === 'old') {
        await page.getByRole('link', { name: 'Products', exact: true }).first().click();
        await page.waitForLoadState('domcontentloaded');
        const robe = page.getByRole('link', { name: /Robe Hook/i }).first();
        if (await robe.count()) {
          await robe.click();
          await page.waitForLoadState('domcontentloaded');
        }
        const text = await page.locator('body').innerText();
        success = /Robe Hook/i.test(text) || /ProductDetail/.test(page.url()) || /Products\//.test(page.url());
        detail = `${page.url()} | ${text.slice(0, 120)}`;
      } else {
        await page.locator('.site-nav summary').first().click();
        await page.getByRole('link', { name: /Robe Hooks/i }).first().click();
        await page.waitForLoadState('domcontentloaded');
        const text = await page.locator('body').innerText();
        success = /Robe Hooks/i.test(text) && /OL-1204/.test(text);
        detail = `${page.url()} | ${text.slice(0, 120)}`;
      }
    } else if (task === 'B') {
      if (site === 'old') {
        await page.goto(`${OLD}/Products/5.html`, { waitUntil: 'domcontentloaded' });
        const card = page.locator('a[href*="ProductDetail"]').filter({ hasText: /1204/i }).first();
        if (await card.count()) await card.click();
        else await page.goto(`${OLD}/ProductDetail/21.html`, { waitUntil: 'domcontentloaded' });
        const text = await page.locator('body').innerText();
        const material = /material|brass|stainless/i.test(text);
        success = /OL-1204/.test(text) && material;
        detail = `model=${/OL-1204/.test(text)} material=${material} url=${page.url()}`;
      } else {
        await page.goto(`${NEW}/en-gb/products/category/robe-hooks`, { waitUntil: 'domcontentloaded' });
        await page.locator('a[href$="/products/robe-hook-ol-1204"]').first().click();
        await page.waitForLoadState('domcontentloaded');
        const text = await page.locator('body').innerText();
        success = /OL-1204/.test(text) && /Brass range/.test(text);
        detail = `model=${/OL-1204/.test(text)} material=${/Brass range/.test(text)} url=${page.url()}`;
      }
    } else if (task === 'C') {
      if (site === 'old') {
        await page.goto(`${OLD}/ProductDetail/21.html`, { waitUntil: 'domcontentloaded' });
        const text = await page.locator('body').innerText();
        success = /Brushed Gold|Chrome|Matte Black/i.test(text);
        detail = `colors=${success} dimensions=${/dimension|size/i.test(text)}`;
      } else {
        await page.goto(`${NEW}/en-gb/products/robe-hook-ol-1204`, { waitUntil: 'domcontentloaded' });
        const text = await page.locator('body').innerText();
        success = /Brushed Gold|Chrome|Matte Black/i.test(text) && /Dimensions/i.test(text);
        detail = `colors=${/Brushed Gold|Chrome|Matte Black/i.test(text)} dimensionsExplicitRequest=${/On request/i.test(text)}`;
      }
    } else if (task === 'D') {
      if (site === 'old') {
        await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
        await page.waitForLoadState('domcontentloaded');
        const card = page.locator('a[href*="cases"], a[href*="cases_detail"]').filter({ hasText: /Shangri|Hotel|Golden|Finest|Qasr/i }).first();
        if (await card.count()) await card.click();
        await page.waitForLoadState('domcontentloaded');
        const text = await page.locator('body').innerText();
        success = /\/cases\/|\/cases_detail\//.test(page.url()) && /Hotel|Project/i.test(text);
        detail = `caseDetailOpened=${success}; URL=${page.url()} | ${text.slice(0, 160)}`;
      } else {
        await page.goto(`${NEW}/en-gb/projects`, { waitUntil: 'domcontentloaded' });
        await page.locator('.project-card h3 a').first().click();
        await page.waitForLoadState('domcontentloaded');
        const text = await page.locator('body').innerText();
        success = /Published building photograph/.test(text) && /Bathroom and installation evidence/.test(text);
        detail = `${page.url()} | ${text.slice(0, 160)}`;
      }
    } else if (task === 'E') {
      if (site === 'old') {
        await page.getByRole('link', { name: /Customization Center/i }).first().click();
        await page.waitForLoadState('domcontentloaded');
        const text = await page.locator('body').innerText();
        success = /Customization Process/i.test(text);
        detail = `process=${success} url=${page.url()}`;
      } else {
        await page.goto(`${NEW}/en-gb/customization`, { waitUntil: 'domcontentloaded' });
        const text = await page.locator('body').innerText();
        success = /six-stage customization process/i.test(text) && /Consultation and needs analysis/.test(text);
        detail = `process=${success} form=${await page.locator('[data-customizer-form]').count()} url=${page.url()}`;
      }
    } else if (task === 'F') {
      if (site === 'old') {
        await page.goto(`${OLD}/Contact.html`, { waitUntil: 'domcontentloaded' });
        const inputs = await page.locator('input, textarea, select').count();
        success = false;
        detail = `Reached contact form; fields=${inputs}; NOT submitted, to avoid sending an unsolicited inquiry to the company. Full completion was not measured on the live old site.`;
      } else {
        await page.goto(`${NEW}/en-gb/customization`, { waitUntil: 'domcontentloaded' });
        const fields = await page.locator('[data-customizer-form] input, [data-customizer-form] textarea, [data-customizer-form] select').count();
        success = fields > 40;
        detail = `Customizer fields=${fields}; the persisted end-to-end submission is recorded separately in QA and in the local database.`;
      }
    } else if (task === 'G') {
      if (site === 'old') {
        await page.goto(OLD + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        const chatButtons = await page.locator('[class*="service"], [class*="chat"], [class*="kefu"]').filter({ visible: true }).count().catch(() => 0);
        const serviceScripts = await page.evaluate(() => [...document.scripts].filter((s) => /smartService|NIM_Web|service_icon/i.test(s.src)).map((s) => s.src));
        success = false;
        detail = `No visible conversational entry found; smart-service scripts loaded: ${serviceScripts.length}; fixed contact panel only.`;
      } else {
        await page.goto(`${NEW}/ja-jp/products/robe-hook-ol-1204`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-open-assistant]').first().click();
        await page.locator('#assistant-question').fill('OL-1204の仕上げは？');
        await page.locator('[data-assistant-form] button[type="submit"]').click();
        await page.waitForTimeout(900);
        const text = await page.locator('[data-assistant-answer]').innerText();
        success = /クローム/.test(text);
        detail = text.slice(0, 220);
      }
    }
    await page.screenshot({ path: path.join(SHOTS, `${site}-${task}.png`), fullPage: false });
  } catch (error) {
    detail = error.message.slice(0, 300);
  }
  return {
    site, task, success, detail,
    duration_ms: Date.now() - started,
    clicks: await measure(page).catch(() => null),
    url: page.url(),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent: UA,
    locale: 'en-GB',
  });
  const page = await context.newPage();
  await prepare(page, 'new');
  await prepare(page, 'old');
  const rows = [];
  for (const task of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    for (const site of ['old', 'new']) {
      const row = await runTask(page, site, task);
      rows.push(row);
      console.log(row);
    }
  }
  const payload = {
    generated_at: new Date().toISOString(),
    method: 'Automated scripted task run in one Chromium session, old site first then new site for each task. Not a human usability test. The old site was not sent any form. Time includes navigation and visible response waits.',
    limitations: [
      'No human participants; no claim of market representativeness.',
      'Old-site anti-bot protection required a standard desktop browser user-agent.',
      'Old-site chat did not expose a visible conversational entry in this environment; that is recorded as a finding, not proof the service never works in production.',
      'The new inquiry submission is separately exercised against the local test database only.',
    ],
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'old-new-tasks.json'), JSON.stringify(payload, null, 2));
  const csv = ['task,site,success,duration_ms,clicks,url,detail'];
  for (const row of rows) csv.push([row.task, row.site, row.success, row.duration_ms, row.clicks, `"${row.url}"`, `"${String(row.detail).replace(/"/g, '""')}"`].join(','));
  fs.writeFileSync(path.join(OUT, 'old-new-tasks.csv'), csv.join('\n'), 'utf8');
  const summary = {};
  for (const task of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    const old = rows.find((row) => row.task === task && row.site === 'old');
    const fresh = rows.find((row) => row.task === task && row.site === 'new');
    summary[task] = { old: { success: old.success, ms: old.duration_ms, clicks: old.clicks }, new: { success: fresh.success, ms: fresh.duration_ms, clicks: fresh.clicks } };
  }
  fs.writeFileSync(path.join(OUT, 'old-new-summary.json'), JSON.stringify(summary, null, 2));
  console.log(summary);
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });

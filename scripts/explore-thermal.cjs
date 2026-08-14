#!/usr/bin/env node
// Live Thermal exploration harness — click through every ticker, DTE toggle, tab,
// and grid state on /heatmap and screenshot each intermediate state so we can
// review the UI/UX offline. Committed so future UX audits (or drift checks
// after a Thermal refactor) have a repeatable starting point — see the
// 2026-08-14 UX pass in docs/audit/FINDINGS.md for the pattern.
const fs = require('fs');
const { execSync } = require('child_process');
const { createTunneledContext } = require('/home/user/blackout-web/scripts/audit/lib/proxy-tunnel-context.cjs');

const OUT = '/tmp/thermal-ux';
fs.mkdirSync(OUT, { recursive: true });

function mintCookies() {
  const tmp = `/tmp/thermal-cookies-${Date.now()}.json`;
  execSync(
    `cd /home/user/blackout-web && env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx -e "
import { mintIosPlaywrightSession } from './scripts/audit/lib/ios-playwright-auth.mjs';
import { writeFileSync } from 'node:fs';
const s = await mintIosPlaywrightSession({ appUrl: 'https://blackouttrades.com' });
if (s.skip) { console.error('SKIP:', s.reason); process.exit(1); }
writeFileSync('${tmp}', JSON.stringify(s.cookies));
console.error('cookies=' + s.cookies.length);
"`,
    { stdio: 'inherit' },
  );
  const cookies = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function shot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  const kb = (fs.statSync(path).size / 1024).toFixed(0);
  console.error(`  📸 ${name}.png (${kb}KB)`);
}

async function log(page, tag) {
  const html = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.error(`  [${tag}] first 200: ${html.replace(/\s+/g, ' ').slice(0, 180)}`);
}

(async () => {
  console.error('Minting Clerk premium session…');
  const cookieHeader = mintCookies();

  const { browser, ctx } = await createTunneledContext({
    url: 'https://blackouttrades.com/heatmap',
    cookie: cookieHeader,
    viewport: '2560x1400',
    desktop: true,
  });

  const page = await ctx.newPage();
  await page.goto('https://blackouttrades.com/heatmap', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(12000);

  console.error('\n=== INITIAL LOAD ===');
  await shot(page, '00-initial');
  await log(page, 'initial');

  console.error('\n=== ENUMERATE INTERACTIVE ELEMENTS ===');
  const interactives = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, [role="tab"], [role="button"], [data-testid], a[href^="/"]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      out.push({
        tag: el.tagName,
        text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 60).replace(/\s+/g, ' ').trim(),
        testid: el.getAttribute('data-testid') || '',
        role: el.getAttribute('role') || '',
        cls: (el.className || '').toString().slice(0, 80),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    });
    return out.filter((e) => e.text || e.testid).slice(0, 60);
  });
  console.error(`  found ${interactives.length} interactive elements`);
  fs.writeFileSync(`${OUT}/interactives.json`, JSON.stringify(interactives, null, 2));

  console.error('\n=== TICKER SWITCH ===');
  const tickers = ['SPY', 'QQQ', 'TSLA', 'NVDA', 'AAPL'];
  for (const t of tickers) {
    console.error(`  → try ${t}`);
    const clicked = await page.evaluate((ticker) => {
      const els = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"]'));
      const match = els.find((el) => (el.innerText || '').trim() === ticker);
      if (match) { match.click(); return true; }
      return false;
    }, t);
    if (clicked) {
      await page.waitForTimeout(4000);
      await shot(page, `01-ticker-${t}`);
    } else {
      console.error(`  [MISS] no ticker button for ${t}`);
    }
  }

  console.error('\n=== DTE TOGGLES ===');
  const dtes = ['0DTE', '1DTE', 'WEEKLY', 'MONTHLY', 'ALL'];
  for (const d of dtes) {
    const clicked = await page.evaluate((dte) => {
      const els = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"]'));
      const match = els.find((el) => {
        const t = (el.innerText || '').trim().toUpperCase();
        return t === dte || t.startsWith(dte);
      });
      if (match) { match.click(); return true; }
      return false;
    }, d);
    if (clicked) {
      await page.waitForTimeout(3500);
      await shot(page, `02-dte-${d}`);
    } else {
      console.error(`  [MISS] no DTE toggle for ${d}`);
    }
  }

  console.error('\n=== SCROLL POSITIONS ===');
  const scrollPos = [300, 800, 1500];
  for (const y of scrollPos) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
    await page.waitForTimeout(1500);
    await shot(page, `03-scroll-${y}`);
  }

  await browser.close();
  console.error('\nDone. Shots in', OUT);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

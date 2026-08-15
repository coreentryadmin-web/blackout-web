#!/usr/bin/env node
/**
 * Full homepage interaction audit — clicks nav, footer, CTAs, mobile menu,
 * back/forward, anchors, external-link behavior. Writes JSON report + exits non-zero on issues.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/homepage-e2e-audit.json";
mkdirSync(join(OUT, ".."), { recursive: true });

/** @typedef {{ severity: string, code: string, detail: string }} Issue */

/** @param {import('playwright').Page} page */
async function collectPerf(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries[lcpEntries.length - 1];
    return {
      fcp: fcp?.startTime ?? null,
      lcp: lcp?.startTime ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      loadEventEnd: nav?.loadEventEnd ?? null,
      transferSize: nav?.transferSize ?? null,
    };
  });
}

/** @param {import('playwright').Browser} browser */
async function runDesktop(browser) {
  /** @type {Issue[]} */
  const issues = [];
  /** @type {string[]} */
  const passes = [];

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  passes.push("homepage loaded (desktop)");

  // Header auth CTAs (signed-out)
  const signIn = page.locator('.mkt-nav-auth a[href="/sign-in"]');
  if ((await signIn.count()) === 0) {
    issues.push({ severity: "P0", code: "SIGN_IN_MISSING", detail: "No Sign in link in header" });
  } else {
    await signIn.click();
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    passes.push("Sign in → /sign-in");
    await page.goBack({ waitUntil: "domcontentloaded" });
    passes.push("back from sign-in → homepage");
  }

  const getAccess = page.locator('.mkt-nav-auth a[href="/sign-up"], .nav-join[href="/sign-up"]');
  if ((await getAccess.count()) > 0) {
    await getAccess.first().click();
    await page.waitForURL(/\/sign-up/, { timeout: 15_000 });
    passes.push("Get access → /sign-up");
    await page.goBack({ waitUntil: "domcontentloaded" });
  }

  // In-page anchor from hero
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const explore = page.locator('a.btn-g[href="#modules"], a[href="#modules"]').first();
  if ((await explore.count()) > 0) {
    await explore.click();
    await page.waitForTimeout(600);
    const y = await page.evaluate(() => {
      const el = document.getElementById("modules");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, id: el.id };
    });
    if (!y || y.top > 120 || y.top < -80) {
      issues.push({
        severity: "P1",
        code: "ANCHOR_SCROLL_FAIL",
        detail: `#modules scroll position top=${y?.top}`,
      });
    } else {
      passes.push("#modules anchor scroll OK");
    }
  }

  // Footer sample links
  for (const [label, path] of [
    ["Pricing", "/pricing"],
    ["FAQ", "/faq"],
    ["Terms", "/terms"],
    ["Privacy", "/privacy"],
  ]) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const link = page.locator(`footer a[href="${path}"]`).first();
    if ((await link.count()) === 0) {
      issues.push({ severity: "P1", code: "FOOTER_LINK_MISSING", detail: `${label} ${path}` });
      continue;
    }
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL(new RegExp(`${path.replace("/", "\\/")}(\\?|$)`), { timeout: 15_000 });
    passes.push(`footer ${label} → ${path}`);
  }

  // External links open new tab
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const discord = page.locator('footer a[href*="discord"]').first();
  if ((await discord.count()) > 0) {
    const target = await discord.getAttribute("target");
    const rel = await discord.getAttribute("rel");
    if (target !== "_blank") {
      issues.push({ severity: "P2", code: "EXTERNAL_NO_BLANK", detail: "Discord missing target=_blank" });
    } else {
      passes.push("Discord target=_blank");
    }
    if (!rel?.includes("noopener")) {
      issues.push({ severity: "P2", code: "EXTERNAL_NO_NOOPENER", detail: "Discord missing rel=noopener" });
    }
  }

  const perf = await collectPerf(page);
  await ctx.close();
  return { label: "desktop", issues, passes, perf, consoleErrors: consoleErrors.slice(0, 15) };
}

/** @param {import('playwright').Browser} browser */
async function runMobile(browser) {
  /** @type {Issue[]} */
  const issues = [];
  /** @type {string[]} */
  const passes = [];

  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const menuBtn = page.locator(".mkt-nav-menu-btn");
  if ((await menuBtn.count()) === 0) {
    issues.push({ severity: "P0", code: "MOBILE_NAV_MISSING", detail: "No hamburger button" });
  } else {
    passes.push("mobile menu button present");
    await menuBtn.click();
    const drawer = page.locator("#mkt-mobile-menu.is-open");
    await drawer.waitFor({ state: "visible", timeout: 5000 });
    passes.push("mobile drawer opens");

    const platform = drawer.locator('a[href="/#protocol"], a[href="#protocol"]').first();
    if ((await platform.count()) === 0) {
      issues.push({ severity: "P1", code: "MOBILE_NAV_LINK", detail: "Platform link missing in drawer" });
    } else {
      await platform.click();
      await page.waitForTimeout(700);
      const hash = await page.evaluate(() => location.hash);
      if (hash !== "#protocol") {
        issues.push({ severity: "P1", code: "MOBILE_ANCHOR", detail: `Expected #protocol got ${hash}` });
      } else {
        passes.push("mobile Platform → #protocol");
      }
    }

    // Re-open menu and test Escape
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await menuBtn.click();
    await drawer.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const hidden = await drawer.evaluate((el) => !el.classList.contains("is-open"));
    if (!hidden) {
      issues.push({ severity: "P2", code: "MOBILE_ESCAPE", detail: "Escape did not close drawer" });
    } else {
      passes.push("Escape closes mobile drawer");
    }
  }

  const perf = await collectPerf(page);
  await ctx.close();
  return { label: "mobile", issues, passes, perf };
}

const browser = await chromium.launch({ headless: true });
const desktop = await runDesktop(browser);
const mobile = await runMobile(browser);
await browser.close();

const report = {
  generated_at: new Date().toISOString(),
  base: BASE,
  desktop,
  mobile,
  issue_count: desktop.issues.length + mobile.issues.length,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.issue_count > 0 ? 1 : 0);

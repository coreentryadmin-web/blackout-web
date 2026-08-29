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

function homeUrl() {
  return `${BASE}/?_cb=${Date.now()}`;
}

/** @param {import('playwright').Page} page */
async function gotoHome(page, opts = {}) {
  const url = homeUrl();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000, ...opts });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/interrupted by another navigation/i.test(msg) || attempt === 2) throw e;
      await page.waitForTimeout(400);
    }
  }
}

/** Auth/footer navigations can miss the load event during edge churn — retry with domcontentloaded. */
async function clickAndWaitForPath(page, locator, pathPattern, { timeout = 20_000, retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await locator.click({ timeout: 12_000 });
      await page.waitForURL(pathPattern, { timeout, waitUntil: "domcontentloaded" });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === retries - 1) throw e;
      if (!/Timeout|timeout|interrupted|detached|Target closed/i.test(msg)) throw e;
      await page.waitForTimeout(600);
    }
  }
}

/** Footer links can detach mid-scroll during hydration — retry before failing the desktop suite. */
async function scrollClickStable(page, locator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await locator.waitFor({ state: "visible", timeout: 12_000 });
      await locator.scrollIntoViewIfNeeded({ timeout: 12_000 });
      await locator.click({ timeout: 12_000 });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/not attached|detached|stable|Target closed/i.test(msg) || attempt === 2) throw e;
      await page.waitForTimeout(500);
    }
  }
}

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

  await gotoHome(page);
  await page.waitForTimeout(2000);
  passes.push("homepage loaded (desktop)");

  // Header auth CTAs (signed-out)
  const signIn = page.locator('.mkt-nav-auth a[href="/sign-in"]');
  if ((await signIn.count()) === 0) {
    issues.push({ severity: "P0", code: "SIGN_IN_MISSING", detail: "No Sign in link in header" });
  } else {
    await clickAndWaitForPath(page, signIn, /\/sign-in/);
    passes.push("Sign in → /sign-in");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/?(\?_cb=|$)/, { timeout: 15_000, waitUntil: "domcontentloaded" });
    passes.push("back from sign-in → homepage");
  }

  const getAccess = page.locator('.mkt-nav-auth a.nav-join[href="/sign-up"]');
  if ((await getAccess.count()) > 0) {
    await clickAndWaitForPath(page, getAccess, /\/sign-up/);
    passes.push("Get access → /sign-up");
    await page.goBack({ waitUntil: "domcontentloaded" });
  }

  // In-page anchor from hero
  await gotoHome(page);
  const explore = page.locator('a.btn-g[href="#modules"], a[href="#modules"]').first();
  if ((await explore.count()) > 0) {
    await explore.click();
    await page.waitForTimeout(1200);
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
    await gotoHome(page);
    await page.locator("footer").waitFor({ state: "visible", timeout: 12_000 });
    const link = page.locator(`footer a[href="${path}"]`).first();
    if ((await link.count()) === 0) {
      issues.push({ severity: "P1", code: "FOOTER_LINK_MISSING", detail: `${label} ${path}` });
      continue;
    }
    await scrollClickStable(page, link);
    await page.waitForURL(new RegExp(`${path.replace("/", "\\/")}(\\?|$)`), {
      timeout: 20_000,
      waitUntil: "domcontentloaded",
    });
    passes.push(`footer ${label} → ${path}`);
  }

  // External links open new tab
  await gotoHome(page);
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
  await gotoHome(page);
  await page.waitForTimeout(1500);

  const menuBtn = page.locator(".mkt-nav-menu-btn");
  if ((await menuBtn.count()) === 0) {
    issues.push({ severity: "P0", code: "MOBILE_NAV_MISSING", detail: "No hamburger button" });
  } else {
    passes.push("mobile menu button present");
    await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
    await menuBtn.click();
    await page.waitForSelector('.mkt-nav-menu-btn[aria-expanded="true"]', { timeout: 8000 });
    const drawer = page.locator("#mkt-mobile-menu");
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
    await gotoHome(page);
    await page.waitForTimeout(800);
    const menuBtn2 = page.locator(".mkt-nav-menu-btn");
    await menuBtn2.waitFor({ state: "visible", timeout: 10_000 });
    await menuBtn2.click();
    await page.waitForSelector('.mkt-nav-menu-btn[aria-expanded="true"]', { timeout: 8000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const expanded = await menuBtn2.getAttribute("aria-expanded");
    if (expanded !== "false") {
      issues.push({ severity: "P2", code: "MOBILE_ESCAPE", detail: "Escape did not close drawer" });
    } else {
      passes.push("Escape closes mobile drawer");
    }
  }

  const perf = await collectPerf(page);
  await ctx.close();
  return { label: "mobile", issues, passes, perf };
}

/** Reproduce FINDINGS P2 #2799 — sticky bar must not block FAQ taps after opening items above. */
async function runMobileFaqSticky(browser) {
  /** @type {Issue[]} */
  const issues = [];
  /** @type {string[]} */
  const passes = [];

  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await gotoHome(page);
  await page.waitForTimeout(1200);

  // Scroll past hero so sticky CTA becomes visible.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  const faqItems = page.locator(".sec-faq .faq-item");
  const count = await faqItems.count();
  if (count < 3) {
    issues.push({ severity: "P1", code: "FAQ_ITEMS_MISSING", detail: `Expected ≥3 FAQ items, got ${count}` });
    await ctx.close();
    return { label: "mobile-faq-sticky", issues, passes };
  }

  // Open first two items — grows page so item 3 lands in sticky footprint without fix.
  for (let i = 0; i < 2; i++) {
    await faqItems.nth(i).locator("summary").click();
    await page.waitForTimeout(250);
  }

  const third = faqItems.nth(2);
  const overlap = await page.evaluate(() => {
    const bar = document.getElementById("mobile-sticky-cta");
    const item = document.querySelectorAll(".sec-faq .faq-item")[2];
    if (!bar || !item) return { visible: false, overlaps: false };
    const a = bar.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    const visible = bar.classList.contains("visible");
    const overlaps = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return { visible, overlaps };
  });

  if (overlap.visible && overlap.overlaps) {
    issues.push({
      severity: "P2",
      code: "STICKY_FAQ_OVERLAP",
      detail: "mobile sticky CTA overlaps FAQ item 3 while visible",
    });
  } else {
    passes.push("sticky CTA suppressed before FAQ item 3 overlap");
  }

  const openBefore = await third.evaluate((el) => (el instanceof HTMLDetailsElement ? el.open : false));
  await third.locator("summary").click({ timeout: 8000 });
  await page.waitForTimeout(300);
  const openAfter = await third.evaluate((el) => (el instanceof HTMLDetailsElement ? el.open : false));
  if (openAfter === openBefore) {
    issues.push({
      severity: "P2",
      code: "FAQ_TAP_BLOCKED",
      detail: "FAQ item 3 summary click did not toggle (likely sticky intercept)",
    });
  } else {
    passes.push("FAQ item 3 toggles after opening items 1–2");
  }

  await ctx.close();
  return { label: "mobile-faq-sticky", issues, passes };
}

const browser = await chromium.launch({ headless: true });
let desktop;
let mobile;
let mobileFaqSticky;
try {
  desktop = await runDesktop(browser);
} catch (e) {
  desktop = {
    label: "desktop",
    issues: [{ severity: "P0", code: "DESKTOP_CRASH", detail: e instanceof Error ? e.message : String(e) }],
    passes: [],
    perf: {},
    consoleErrors: [],
  };
}
try {
  mobile = await runMobile(browser);
} catch (e) {
  mobile = {
    label: "mobile",
    issues: [{ severity: "P0", code: "MOBILE_CRASH", detail: e instanceof Error ? e.message : String(e) }],
    passes: [],
    perf: {},
  };
}
try {
  mobileFaqSticky = await runMobileFaqSticky(browser);
} catch (e) {
  mobileFaqSticky = {
    label: "mobile-faq-sticky",
    issues: [{ severity: "P0", code: "FAQ_STICKY_CRASH", detail: e instanceof Error ? e.message : String(e) }],
    passes: [],
  };
}
await browser.close();

const report = {
  generated_at: new Date().toISOString(),
  base: BASE,
  desktop,
  mobile,
  mobileFaqSticky,
  issue_count: desktop.issues.length + mobile.issues.length + mobileFaqSticky.issues.length,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.issue_count > 0 ? 1 : 0);

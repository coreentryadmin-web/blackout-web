#!/usr/bin/env node
/**
 * Homepage link + interaction audit — Playwright against production (or VALIDATE_BASE).
 * Output: /opt/cursor/artifacts/homepage-audit-report.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/homepage-audit-report.json";
mkdirSync(join(OUT, ".."), { recursive: true });

function homeUrl() {
  return `${BASE}/?_cb=${Date.now()}`;
}

async function gotoHome(page) {
  await page.goto(homeUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
}

const REQUIRED_PATHS = [
  "/sign-in",
  "/sign-up",
  "/upgrade",
  "/pricing",
  "/learn",
  "/faq",
  "/terms",
  "/privacy",
  "/disclaimer",
  "/refund-policy",
  "/cookie-policy",
  "/about",
  "/contact",
  "/why-blackout",
  "/vs/others",
  "/tools/gamma-snapshot",
];

async function auditViewport(browser, label, viewport, isMobile) {
  const ctx = await browser.newContext({
    ...viewport,
    userAgent: isMobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  const issues = [];
  const passes = [];
  const perf = {};

  const navStart = Date.now();
  const resp = await page.goto(homeUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  perf.domContentLoaded = Date.now() - navStart;
  perf.status = resp?.status() ?? null;

  await page.waitForTimeout(1500);

  const paints = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      loadEventEnd: nav?.loadEventEnd ?? null,
      fcp: fcp?.startTime ?? null,
    };
  });
  perf.fcp = paints.fcp;
  perf.loadEventEnd = paints.loadEventEnd;

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const links = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("a[href]")) {
      const href = el.getAttribute("href") || "";
      const text = (el.textContent || "").trim().slice(0, 80);
      const external = href.startsWith("http");
      const target = el.getAttribute("target");
      out.push({ href, text, external, target, visible: el.offsetParent !== null || getComputedStyle(el).position === "fixed" });
    }
    return out;
  });

  passes.push(`loaded homepage (${links.length} links found)`);

  // Mobile nav visibility
  if (isMobile) {
    const navLinksVisible = await page.locator(".mkt-nav-links").isVisible().catch(() => false);
    const menuBtn = await page.locator(".mkt-nav-menu-btn, [aria-controls='mkt-mobile-menu']").count();
    if (!navLinksVisible && menuBtn === 0) {
      issues.push({
        severity: "P0",
        code: "MOBILE_NAV_MISSING",
        detail: "Desktop nav links hidden on mobile but no hamburger/menu button found",
      });
    } else if (menuBtn > 0) {
      passes.push("mobile menu button present");
    }
  }

  // Anchor links (nav uses /#section on marketing shell)
  for (const hash of ["#modules", "#protocol", "#pricing", "#faq"]) {
    const id = hash.slice(1);
    const el = await page
      .locator(
        `a[href='${hash}'], a[href='/${hash}'], a[href='/${id}'], a[href='${BASE}${hash}']`,
      )
      .first()
      .count();
    if (el === 0) {
      issues.push({ severity: "P1", code: "ANCHOR_MISSING", detail: `No link to ${hash}` });
    } else {
      passes.push(`anchor link ${hash} present`);
    }
  }

  // Sample internal link checks (HEAD request)
  for (const path of REQUIRED_PATHS) {
    try {
      const r = await page.request.get(`${BASE}${path}`, { maxRedirects: 5 });
      if (r.status() >= 400) {
        issues.push({ severity: "P0", code: "ROUTE_4XX", detail: `${path} → ${r.status()}` });
      } else {
        passes.push(`${path} → ${r.status()}`);
      }
    } catch (e) {
      issues.push({ severity: "P0", code: "ROUTE_FAIL", detail: `${path}: ${e.message}` });
    }
  }

  // External social links
  for (const [name, pattern] of [
    ["discord", /discord\.gg/i],
    ["x", /x\.com/i],
    ["instagram", /instagram\.com/i],
  ]) {
    const found = links.some((l) => pattern.test(l.href));
    if (!found) issues.push({ severity: "P1", code: "SOCIAL_MISSING", detail: `No ${name} link on homepage` });
    else passes.push(`${name} link present`);
  }

  // Whop checkout links (optional env)
  const whop = links.filter((l) => /whop\.com/i.test(l.href));
  if (whop.length) passes.push(`whop links: ${whop.length}`);

  await ctx.close();
  return { label, perf, issues, passes, consoleErrors: consoleErrors.slice(0, 10) };
}

const browser = await chromium.launch({ headless: true });
const desktop = await auditViewport(browser, "desktop", { viewport: { width: 1280, height: 800 } }, false);
const mobile = await auditViewport(browser, "mobile", devices["iPhone 13"], true);
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

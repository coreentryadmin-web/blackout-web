#!/usr/bin/env node
/** Homepage Web Vitals probe — marketing shell only. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/homepage-perf.json";
mkdirSync(join(OUT, ".."), { recursive: true });

async function profile(label, contextOpts) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();

  const requests = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("_next/") || u.match(/\.(js|css|woff2?|png|jpg|webp|svg)(\?|$)/i)) {
      requests.push({ url: u.split("?")[0].slice(-80), type: r.resourceType() });
    }
  });

  await page.goto(`${BASE}/?_cb=${Date.now()}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries[lcpEntries.length - 1];
    let cls = 0;
    for (const e of performance.getEntriesByType("layout-shift")) {
      if (!e.hadRecentInput) cls += e.value;
    }
    return {
      ttfb: nav ? nav.responseStart - nav.requestStart : null,
      fcp: fcp?.startTime ?? null,
      lcp: lcp?.startTime ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      loadEventEnd: nav?.loadEventEnd ?? null,
      transferSize: nav?.transferSize ?? null,
      cls: Math.round(cls * 1000) / 1000,
      jsRequests: performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script").length,
    };
  });

  await browser.close();
  return { label, vitals, assetSamples: requests.slice(0, 20) };
}

const desktop = await profile("desktop", { viewport: { width: 1280, height: 900 } });
const mobile = await profile("mobile", { ...devices["iPhone 13"] });

const report = { generated_at: new Date().toISOString(), base: BASE, desktop, mobile };
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

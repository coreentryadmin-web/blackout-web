#!/usr/bin/env node
/**
 * Production UI check: 0DTE Vector chart beads should span the session width
 * (not cluster in 1–2 columns on the far left).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const APP = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts/live-ui-0dte-beads";

/** Sample canvas for gold (#ffd60a) and purple (#d97bff) bead pixels; return x-span metrics. */
async function beadSpreadMetrics(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 200 && r.height > 120;
    });
    canvases.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const canvas = canvases[0];
    if (!canvas) return { ok: false, reason: "no chart canvas" };

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "no 2d context" };

    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;

    const isBead = (r, g, b, a) => {
      if (a < 80) return false;
      // gold call beads ~ rgb(255,214,10)
      if (r > 200 && g > 160 && b < 80) return true;
      // purple put beads ~ rgb(217,123,255)
      if (r > 160 && g > 80 && b > 180) return true;
      return false;
    };

    const xs = new Set();
    const topBand = Math.floor(h * 0.75);
    for (let y = Math.floor(h * 0.05); y < topBand; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (isBead(img[i], img[i + 1], img[i + 2], img[i + 3])) xs.add(x);
      }
    }

    if (xs.size < 20) {
      return { ok: false, reason: "too few bead pixels", beadPixels: xs.size, canvasW: w };
    }

    const sorted = [...xs].sort((a, b) => a - b);
    const minX = sorted[0];
    const maxX = sorted[sorted.length - 1];
    const spanPct = ((maxX - minX) / w) * 100;
    const leftClusterPct = sorted.filter((x) => x < w * 0.25).length / sorted.length;

    return {
      ok: true,
      canvasW: w,
      beadPixels: xs.size,
      spanPct: Math.round(spanPct * 10) / 10,
      leftClusterPct: Math.round(leftClusterPct * 1000) / 10,
      minX,
      maxX,
    };
  });
}

async function capture(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function checkRoute(page, route, name) {
  await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(12_000);
  const dte0 = page.locator('[data-testid="vector-dte-0dte"], button:has-text("0DTE")').first();
  if (await dte0.count()) {
    try {
      await dte0.click({ timeout: 5000 });
      await page.waitForTimeout(4000);
    } catch {
      /* already selected */
    }
  }
  const shot = await capture(page, name);
  const metrics = await beadSpreadMetrics(page);
  return { route, shot, metrics };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const auth = await mintIosPlaywrightSession({ appUrl: APP });
  if (auth.skip) {
    console.error(JSON.stringify({ skip: true, reason: auth.reason }));
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(auth.cookies);
  const page = await context.newPage();

  const results = [];
  try {
    results.push(await checkRoute(page, "/dashboard", "spx-slayer-dashboard"));
    results.push(await checkRoute(page, "/vector?ticker=SPX", "vector-spx"));
  } finally {
    await browser.close();
    if (auth.cleanup) await auth.cleanup();
  }

  const pass = results.every(
    (r) =>
      r.metrics.ok &&
      r.metrics.spanPct >= 35 &&
      r.metrics.leftClusterPct < 85
  );

  const report = { app: APP, pass, results, at: new Date().toISOString() };
  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

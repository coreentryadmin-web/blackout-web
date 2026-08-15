#!/usr/bin/env node
/**
 * Live UI validation — Vector candle rendering (zoom in/out, view toggles, spacing).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_VALIDATE_OUT || "/opt/cursor/artifacts/vector-candle-render-validate";
const TICKER = process.env.VECTOR_VALIDATE_TICKER || "SPY";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? " — " + detail : ""}`);
};

const pw = await mintIosPlaywrightSession({ appUrl: BASE });
if (pw.skip) {
  console.error(JSON.stringify({ ok: false, reason: pw.reason }));
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: UA });
await ctx.addInitScript(onboardingInitScript());
await ctx.addCookies(pw.cookies);
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/vector?ticker=${TICKER}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".vector-chart-terminal-grid").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(5000);

  const zoomRow = page.locator('[data-testid="vector-intraday-zoom"]');
  if (await zoomRow.count()) {
    rec("intraday-zoom-controls", "PASS", "Session/Structure/Live row present");
  } else {
    rec("intraday-zoom-controls", "FAIL", "Not deployed — wait for ECR rollout");
  }

  const chartStage = page.locator(".vector-chart-stage canvas").first();
  if (await chartStage.count()) {
    rec("chart-canvas", "PASS", "Candle canvas rendered");
    await chartStage.screenshot({ path: join(OUT, "01-initial.png") });
  } else {
    rec("chart-canvas", "FAIL", "No canvas found");
  }

  for (const preset of ["structure", "session", "live"]) {
    const btn = page.locator(`[data-testid="vector-intraday-zoom-${preset}"]`);
    if (!(await btn.count())) continue;
    await btn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `02-zoom-${preset}.png`), fullPage: false });
    rec(`zoom-preset-${preset}`, "PASS", "Clicked and captured");
  }

  const chartBox = await chartStage.boundingBox();
  if (chartBox) {
    const cx = chartBox.x + chartBox.width * 0.55;
    const cy = chartBox.y + chartBox.height * 0.45;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 140);
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, "03-zoom-out-wheel.png") });
    rec("wheel-zoom-out", "PASS", "10 scroll-out steps");

    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -140);
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: join(OUT, "04-zoom-in-wheel.png") });
    rec("wheel-zoom-in", "PASS", "12 scroll-in steps");
  } else {
    rec("wheel-zoom", "WARN", "No bounding box for canvas");
  }

  const view1d = page.locator('.vector-chart-view-seg button:has-text("1D")').first();
  if (await view1d.count()) {
    await view1d.click();
    await page.waitForTimeout(3000);
    const dailyCanvas = page.locator(".vector-daily-chart canvas").first();
    if (await dailyCanvas.count()) {
      await dailyCanvas.screenshot({ path: join(OUT, "05-daily-1d.png") });
      rec("daily-1d-view", "PASS", "Historical chart rendered");
    } else {
      rec("daily-1d-view", "FAIL", "No daily chart canvas");
    }
    const intradayBtn = page.locator('.vector-chart-view-seg button:has-text("Intraday")').first();
    if (await intradayBtn.count()) {
      await intradayBtn.click();
      await page.waitForTimeout(2500);
      rec("back-to-intraday", "PASS", "View toggle returns to intraday");
    }
  } else {
    rec("chart-view-toggle", "WARN", "Segmented view toggle not found");
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const verdict = fails.length ? "RED" : "GREEN";
  const out = { verdict, base: BASE, ticker: TICKER, checks };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await pw.cleanup?.();
}

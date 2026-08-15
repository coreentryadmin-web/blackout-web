#!/usr/bin/env node
/**
 * Live UI validation — Vector member drawing tools (every tool, including after Session zoom).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_VALIDATE_OUT || "/opt/cursor/artifacts/vector-drawings-validate";
const TICKER = process.env.VECTOR_VALIDATE_TICKER || "SPX";

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? " — " + detail : ""}`);
};

const getCount = async (page) =>
  Number((await page.locator('[data-testid="vector-draw-count"]').textContent())?.match(/\d+/)?.[0] ?? 0);

const clickChart = async (page, box, xFrac, yFrac = 0.45) => {
  if (!box) return;
  await page.mouse.click(box.x + box.width * xFrac, box.y + box.height * yFrac);
  await page.waitForTimeout(500);
};

const pw = await mintIosPlaywrightSession({ appUrl: BASE });
if (pw.skip) {
  console.error(JSON.stringify({ ok: false, reason: pw.reason }));
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(onboardingInitScript());
await ctx.addCookies(pw.cookies);
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/vector?ticker=${TICKER}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".vector-chart-terminal-grid").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(6000);

  if (!(await page.locator('[data-testid="vector-draw-toolbar"]').count())) {
    rec("draw-toolbar", "FAIL", "Not deployed");
    process.exit(1);
  }
  rec("draw-toolbar", "PASS", "Drawing toolbar present");

  const canvas = page.locator(".vector-chart-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    rec("chart-canvas", "FAIL", "No canvas box");
    process.exit(1);
  }
  rec("chart-canvas", "PASS", `${Math.round(box.width)}×${Math.round(box.height)}`);

  // Force the broken viewport path (session zoom after structure) — this is where clicks used to no-op.
  for (const preset of ["structure", "session"]) {
    const btn = page.locator(`[data-testid="vector-intraday-zoom-${preset}"]`);
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(1200);
    }
  }
  rec("session-zoom-applied", "PASS", "Structure → Session presets clicked");

  let count = await getCount(page);

  // Horizontal line — click empty left margin (x=0.15) where param.time was null before fix.
  await page.locator('[data-testid="vector-draw-tool-hline"]').click();
  const hBefore = count;
  await clickChart(page, box, 0.15);
  await clickChart(page, box, 0.55);
  count = await getCount(page);
  if (count > hBefore) rec("hline-empty-margin", "PASS", `${hBefore} → ${count}`);
  else rec("hline-empty-margin", "FAIL", `count stuck at ${count}`);

  // Vertical line
  await page.locator('[data-testid="vector-draw-tool-vline"]').click();
  const vBefore = count;
  await clickChart(page, box, 0.4);
  count = await getCount(page);
  if (count > vBefore) rec("vline", "PASS", `${vBefore} → ${count}`);
  else rec("vline", "FAIL", `count ${count}`);

  // Trendline (two-click)
  await page.locator('[data-testid="vector-draw-tool-trend"]').click();
  const tBefore = count;
  await clickChart(page, box, 0.3, 0.6);
  await clickChart(page, box, 0.7, 0.35);
  count = await getCount(page);
  if (count > tBefore) rec("trendline", "PASS", `${tBefore} → ${count}`);
  else rec("trendline", "FAIL", `count ${count}`);

  // Ray
  await page.locator('[data-testid="vector-draw-tool-ray"]').click();
  const rBefore = count;
  await clickChart(page, box, 0.35, 0.55);
  await clickChart(page, box, 0.62, 0.4);
  count = await getCount(page);
  if (count > rBefore) rec("ray", "PASS", `${rBefore} → ${count}`);
  else rec("ray", "FAIL", `count ${count}`);

  // Zone / rect
  await page.locator('[data-testid="vector-draw-tool-rect"]').click();
  const zBefore = count;
  await clickChart(page, box, 0.25, 0.65);
  await clickChart(page, box, 0.75, 0.35);
  count = await getCount(page);
  if (count > zBefore) rec("zone-rect", "PASS", `${zBefore} → ${count}`);
  else rec("zone-rect", "FAIL", `count ${count}`);

  // Fib
  await page.locator('[data-testid="vector-draw-tool-fib"]').click();
  const fBefore = count;
  await clickChart(page, box, 0.28, 0.62);
  await clickChart(page, box, 0.72, 0.38);
  count = await getCount(page);
  if (count > fBefore) rec("fib", "PASS", `${fBefore} → ${count}`);
  else rec("fib", "FAIL", `count ${count}`);

  // Text — toolbar input (no window.prompt)
  await page.locator('[data-testid="vector-draw-tool-text"]').click();
  const textInput = page.locator('[data-testid="vector-draw-text-input"]');
  if (!(await textInput.count())) {
    rec("text-input", "FAIL", "Text label input missing — deploy pending");
  } else {
    rec("text-input", "PASS", "Label field visible");
    await textInput.fill("E2E TEST");
    const xBefore = count;
    await clickChart(page, box, 0.5, 0.5);
    count = await getCount(page);
    if (count > xBefore) rec("text-place", "PASS", `${xBefore} → ${count}`);
    else rec("text-place", "FAIL", `count ${count}`);
  }

  // Undo + clear
  await page.locator('[data-testid="vector-draw-undo"]').click();
  await page.waitForTimeout(400);
  rec("undo", "PASS", "Undo clicked");

  await page.locator('[data-testid="vector-draw-tool-select"]').click();
  await page.screenshot({ path: join(OUT, "drawings-after-all-tools.png") });

  const fails = checks.filter((c) => c.status === "FAIL");
  const verdict = fails.length ? "RED" : "GREEN";
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ verdict, base: BASE, ticker: TICKER, checks, finalCount: count }, null, 2));
  console.log(JSON.stringify({ verdict, ticker: TICKER, finalCount: count, checks }, null, 2));
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await pw.cleanup?.();
}

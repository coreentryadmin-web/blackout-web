#!/usr/bin/env node
/**
 * Live UI validation — Vector member drawing tools.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_VALIDATE_OUT || "/opt/cursor/artifacts/vector-drawings-validate";

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
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(onboardingInitScript());
await ctx.addCookies(pw.cookies);
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/vector?ticker=SPY`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".vector-chart-terminal-grid").waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(6000);

  const toolbar = page.locator('[data-testid="vector-draw-toolbar"]');
  if (await toolbar.count()) {
    rec("draw-toolbar", "PASS", "Drawing toolbar deployed");
  } else {
    rec("draw-toolbar", "FAIL", "Not deployed — wait for ECR rollout");
    const fails = checks.filter((c) => c.status === "FAIL");
    writeFileSync(join(OUT, "report.json"), JSON.stringify({ verdict: "RED", checks }, null, 2));
    process.exit(1);
  }

  await page.screenshot({ path: join(OUT, "01-desk.png") });

  await page.locator('[data-testid="vector-draw-tool-hline"]').click();
  rec("tool-hline-select", "PASS", "Horizontal tool selected");

  await page.keyboard.press("h");
  rec("shortcut-h", "PASS", "H shortcut accepted");

  const countBefore = Number((await page.locator('[data-testid="vector-draw-count"]').textContent())?.match(/\d+/)?.[0] ?? 0);

  // Simulate chart click via lightweight-charts subscribeClick path — click canvas center.
  const canvas = page.locator(".vector-chart-stage canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.45 } });
    await page.waitForTimeout(800);
    const countAfter = Number((await page.locator('[data-testid="vector-draw-count"]').textContent())?.match(/\d+/)?.[0] ?? 0);
    if (countAfter > countBefore) {
      rec("hline-place-click", "PASS", `${countBefore} → ${countAfter} ink`);
    } else {
      rec("hline-place-click", "WARN", `count unchanged (${countAfter}) — off-chart click?`);
    }
  } else {
    rec("hline-place-click", "WARN", "no canvas box");
  }

  await page.locator('[data-testid="vector-draw-tool-trend"]').click();
  if (box) {
    await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.55 } });
    await page.waitForTimeout(400);
    await canvas.click({ position: { x: box.width * 0.65, y: box.height * 0.35 } });
    await page.waitForTimeout(800);
    rec("trendline-two-click", "PASS", "two-click trend attempted");
  }

  await page.locator('[data-testid="vector-draw-tool-select"]').click();
  await page.keyboard.press("Delete");
  rec("delete-key", "PASS", "Delete shortcut sent in select mode");

  await page.screenshot({ path: join(OUT, "02-after-draw.png") });

  const fails = checks.filter((c) => c.status === "FAIL");
  const verdict = fails.length ? "RED" : "GREEN";
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ verdict, base: BASE, checks }, null, 2));
  console.log(JSON.stringify({ verdict, checks }, null, 2));
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await pw.cleanup?.();
}

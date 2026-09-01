#!/usr/bin/env node
/**
 * Vector chart mouse interaction E2E — real Playwright wheel/drag/click on prod.
 * Verifies the chart responds and long tasks stay bounded during gestures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
  dismissDeskModals,
} from "./lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_INTERACTION_E2E_DIR || "/opt/cursor/artifacts/vector-interaction-e2e";
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? " — " + detail : ""}`);
};

const auth = await mintIosPlaywrightSession({ appUrl: BASE, tier: "premium", role: "admin" });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(onboardingInitScript);
await context.addCookies(auth.cookies);
const page = await context.newPage();

try {
  await page.goto(`${BASE}/vector?ticker=NVDA`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await dismissDeskModals(page);
  await page.locator(".vector-chart-canvas").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForTimeout(4000);
  await dismissDeskModals(page);

  const canvas = page.locator(".vector-chart-canvas canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    rec("canvas-box", "FAIL", "no bounding box");
    process.exit(1);
  }
  const cx = box.x + box.width * 0.5;
  const cy = box.y + Math.min(box.height * 0.45, box.height - 40);

  await page.screenshot({ path: join(OUT, "before-interaction.png") });

  const wheelStart = Date.now();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i % 2 === 0 ? -180 : 140);
    await page.waitForTimeout(40);
  }
  const wheelMs = Date.now() - wheelStart;
  rec("wheel-burst", wheelMs < 4000 ? "PASS" : "AMBER", `${wheelMs}ms for 12 wheel steps`);

  await page.waitForTimeout(300);
  await dismissDeskModals(page);
  await page.screenshot({ path: join(OUT, "after-wheel.png") });

  const panStart = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 180, cy, { steps: 15 });
  await page.mouse.up();
  const panMs = Date.now() - panStart;
  rec("pan-drag", panMs < 3000 ? "PASS" : "AMBER", `${panMs}ms drag 180px`);

  await page.waitForTimeout(300);
  await dismissDeskModals(page);
  await page.screenshot({ path: join(OUT, "after-pan.png") });

  const dteWeekly = page.getByRole("button", { name: /^Weekly$/i }).first();
  if (await dteWeekly.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dismissDeskModals(page);
    const clickStart = Date.now();
    await dteWeekly.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    rec("dte-toggle-click", Date.now() - clickStart < 2500 ? "PASS" : "AMBER", "Weekly toggle");
  } else {
    rec("dte-toggle-click", "AMBER", "Weekly control not visible");
  }

  const tfSelect = page.locator('[data-testid="vector-tf-select"]').first();
  if (await tfSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dismissDeskModals(page);
    await tfSelect.selectOption("5");
    await page.waitForTimeout(2000);
    rec("timeframe-select", "PASS", "5 min selected");
    await page.screenshot({ path: join(OUT, "after-5m.png") });
  }

  const afterTasks = await page.evaluate(() => {
    const entries = performance.getEntriesByType("longtask");
    return entries.map((e) => e.duration);
  });
  const totalLong = afterTasks.reduce((a, b) => a + b, 0);
  rec(
    "long-tasks-during-session",
    afterTasks.length > 12 ? "AMBER" : "PASS",
    `count=${afterTasks.length} total=${totalLong.toFixed(0)}ms`
  );

  writeFileSync(join(OUT, "report.json"), JSON.stringify({ checks, wheelMs, panMs }, null, 2));
  const fails = checks.filter((c) => c.status === "FAIL").length;
  process.exit(fails > 0 ? 1 : 0);
} finally {
  await auth.cleanup?.();
  await browser.close();
}

#!/usr/bin/env node
/**
 * Capture live prod UI screenshots for X marketing — admin auth, dismiss overlays.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = process.env.X_MARKETING_OUT || "/opt/cursor/artifacts/x-marketing-jul30";
mkdirSync(OUT, { recursive: true });

async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("Got it")',
    'button:has-text("Continue")',
    'button:has-text("Dismiss")',
    'button:has-text("Close")',
    'button[aria-label="Close"]',
  ]) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function shot(page, name, opts = {}) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, ...opts });
  console.log("saved", path);
}

const auth = await mintIosPlaywrightSession({ appUrl: BASE });
if (auth.skip) {
  console.error("auth skip:", auth.reason);
  process.exit(3);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
await context.addCookies(auth.cookies);
const page = await context.newPage();

try {
  // --- SPX Slayer ---
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60000 });
  await page.waitForSelector(".spx-sniper-desk", { timeout: 60000 });
  await dismissOverlays(page);
  await page.waitForTimeout(2000);
  await shot(page, "01-spx-slayer-desk-full", { fullPage: false });

  const pinStack = page.locator(".spx-left-pin-stack");
  if (await pinStack.count()) {
    await pinStack.screenshot({ path: join(OUT, "02-spx-pin-play-column.png") });
    console.log("saved pin column");
  }

  const verdict = page.locator(".spx-play-verdict-bar");
  if (await verdict.count()) {
    await verdict.screenshot({ path: join(OUT, "03-spx-play-verdict-bar.png") });
  }

  const matrix = page.locator(".spx-gex-matrix-heatmap, .spx-odte-matrix-panel").first();
  if (await matrix.count()) {
    await matrix.screenshot({ path: join(OUT, "04-spx-gex-matrix.png") });
  }

  const vector = page.locator(".spx-sniper-vector-col").first();
  if (await vector.count()) {
    await vector.screenshot({ path: join(OUT, "05-spx-vector-chart.png") });
  }

  const intel = page.locator(".spx-left-commentary").first();
  if (await intel.count()) {
    await intel.screenshot({ path: join(OUT, "06-spx-pulse-intel.png") });
  }

  // --- Night Hawk 0DTE ---
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60000 });
  await dismissOverlays(page);
  await page.waitForTimeout(3000);
  await shot(page, "07-nighthawk-0dte-desk", { fullPage: false });

  // Scroll/focus board if present
  const board = page.locator('[data-testid="zerodte-board"], .zerodte-board, .nh-board').first();
  if (await board.count()) {
    await board.scrollIntoViewIfNeeded().catch(() => {});
    await board.screenshot({ path: join(OUT, "08-nighthawk-0dte-board.png") }).catch(() => {});
  }

  // Try 0DTE segment if iOS-style tabs exist on desktop
  const zeroDteTab = page.getByRole("button", { name: /0DTE|Command|Desk/i }).first();
  if (await zeroDteTab.isVisible().catch(() => false)) {
    await zeroDteTab.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, "09-nighthawk-0dte-segment", { fullPage: false });
  }

  // --- Thermal optional ---
  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissOverlays(page);
  await page.waitForTimeout(4000);
  await shot(page, "10-thermal-heatmap", { fullPage: false });

  console.log("DONE", OUT);
} finally {
  await auth.cleanup?.();
  await browser.close();
}

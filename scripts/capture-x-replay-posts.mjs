#!/usr/bin/env node
/**
 * Capture cross-product replay screenshots for X marketing.
 * Vector replay · HELIX tape replay · Thermal search · SPX Slayer embed.
 *
 * Env:
 *   VALIDATE_BASE / CAPTURE_BASE_URL  (default https://blackouttrades.com)
 *   X_REPLAY_OUT                      output dir
 *   X_REPLAY_TICKERS                  comma list (default MU,SNDK,NBIS,SNXX)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || process.env.CAPTURE_BASE_URL || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.X_REPLAY_OUT || join(process.cwd(), "content/x-posts", process.env.X_REPLAY_DATE || "2026-07-30", "attachments");
const TICKERS = (process.env.X_REPLAY_TICKERS || "MU,SNDK,NBIS,SNXX").split(",").map((s) => s.trim()).filter(Boolean);

mkdirSync(OUT, { recursive: true });

async function dismissOverlays(page) {
  for (let pass = 0; pass < 3; pass++) {
    for (const sel of [
      'button:has-text("Got it")',
      'button:has-text("Continue")',
      'button:has-text("Dismiss")',
      'button:has-text("Close")',
      'button[aria-label="Close"]',
    ]) {
      const b = page.locator(sel).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 2000, force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function searchTickerInput(page, ticker) {
  const candidates = [
    'input[placeholder*="Search any ticker" i]',
    'input[placeholder*="Search" i]',
    'input[placeholder*="ticker" i]',
    'input[aria-label*="ticker" i]',
    'input[type="search"]',
  ];
  for (const sel of candidates) {
    const inp = page.locator(sel).first();
    if (await inp.isVisible().catch(() => false)) {
      await inp.click().catch(() => {});
      await inp.fill("");
      await inp.fill(ticker);
      await page.waitForTimeout(600);
      const opt = page.getByRole("option", { name: new RegExp(`^${ticker}$`, "i") }).first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
      else await inp.press("Enter").catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    }
  }
  return false;
}

async function shot(page, relPath, locator = null) {
  const path = join(OUT, relPath);
  mkdirSync(join(OUT, relPath.split("/").slice(0, -1).join("/") || "."), { recursive: true });
  if (locator) {
    const el = typeof locator === "string" ? page.locator(locator).first() : locator;
    if (await el.isVisible().catch(() => false)) {
      await el.screenshot({ path });
      console.log("saved", path);
      return path;
    }
  }
  await page.screenshot({ path, fullPage: false });
  console.log("saved", path);
  return path;
}

async function captureVectorReplay(page, ticker) {
  await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60000 });
  await dismissOverlays(page);
  await page.waitForSelector(".vector-chart-shell, .vector-page-shell, main", { timeout: 60000 });
  await page.waitForTimeout(4000);

  const replayBtn = page.locator('[data-testid="vector-replay-toggle"]').first();
  const canReplay = await replayBtn.isEnabled().catch(() => false);
  if (canReplay) {
    await replayBtn.click();
    await page.waitForTimeout(800);
    // Jump toward session mid — Open then a few steps forward
    const openBtn = page.getByRole("button", { name: /open/i }).first();
    if (await openBtn.isVisible().catch(() => false)) await openBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowRight").catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
  }

  await shot(page, `${ticker.toLowerCase()}/vector-replay.png`, ".vector-chart-shell, .vector-page-shell");
  await shot(page, `${ticker.toLowerCase()}/vector-toolbar.png`, ".vector-replay-bar, .vector-toolbar");
}

async function captureHelixReplay(page, ticker) {
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissOverlays(page);
  await page.waitForSelector(".helix-page-shell", { timeout: 60000 });
  await page.waitForTimeout(2000);

  await searchTickerInput(page, ticker);

  // Whales off — show more tape for replay buffer
  const whaleBtn = page.getByRole("button", { name: /^WHALES$/i }).first();
  if (await whaleBtn.isVisible().catch(() => false)) {
    const pressed = await whaleBtn.getAttribute("aria-pressed").catch(() => null);
    if (pressed === "true") await whaleBtn.click().catch(() => {});
  }

  await page.waitForTimeout(3000);

  const replayBtn = page.getByRole("button", { name: /▶ Replay|^Replay$/i }).first();
  if (await replayBtn.isVisible().catch(() => false)) {
    await replayBtn.click().catch(() => {});
    await page.waitForTimeout(3500);
    // Speed 2x if available
    const speed2 = page.getByRole("button", { name: /^2×$|^2x$/i }).first();
    if (await speed2.isVisible().catch(() => false)) await speed2.click().catch(() => {});
    await page.waitForTimeout(4000);
  }

  await shot(page, `${ticker.toLowerCase()}/helix-replay-tape.png`, ".helix-page-shell, .flow-panel, main");
  await shot(page, `${ticker.toLowerCase()}/helix-flow-table.png`, ".helix-flow-table, table");
}

async function captureThermal(page, ticker) {
  await page.goto(`${BASE}/heatmap?ticker=${encodeURIComponent(ticker)}&lens=gex`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await dismissOverlays(page);
  await page.waitForSelector(".gex-matrix-scroll, .gex-heatmap, table", { timeout: 90000 });
  await page.waitForTimeout(5000);
  await shot(page, `${ticker.toLowerCase()}/thermal-matrix.png`, ".gex-matrix-scroll, .gex-heatmap-panel, main");
}

async function captureSpxSlayerReplay(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".spx-sniper-desk", { timeout: 60000 });
  await dismissOverlays(page);
  await page.waitForTimeout(3000);

  const replayBtn = page.locator('[data-testid="vector-replay-toggle"]').first();
  if (await replayBtn.isEnabled().catch(() => false)) {
    await replayBtn.click();
    await page.waitForTimeout(800);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("ArrowRight").catch(() => {});
      await page.waitForTimeout(100);
    }
  }

  await shot(page, "spx/slayer-vector-replay.png", ".spx-sniper-vector-col, .vector-chart-shell");
  await shot(page, "spx/slayer-desk-full.png", ".spx-sniper-desk");
  await shot(page, "spx/slayer-pin-verdict.png", ".spx-left-pin-stack");
}

async function captureNightHawkClosed(page) {
  await page.goto(`${BASE}/nighthawk?view=0dte`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissOverlays(page);
  await page.waitForSelector(".nh-deck", { timeout: 90000 });
  await page.waitForTimeout(2000);
  const closedBtn = page.locator('.nh-deck-filtbtn:has-text("CLOSED")');
  if (await closedBtn.isVisible().catch(() => false)) {
    await closedBtn.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await shot(page, "nighthawk/closed-board.png", ".nh-deck");
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

const manifest = { base: BASE, date: "2026-07-30", tickers: TICKERS, shots: [] };

try {
  // Skip SPX if already captured in a partial run
  if (!process.env.X_REPLAY_SKIP_SPX) {
    await captureSpxSlayerReplay(page);
    manifest.shots.push("spx/slayer-vector-replay.png", "spx/slayer-desk-full.png");
  }

  if (!process.env.X_REPLAY_SKIP_HAWK) {
    await captureNightHawkClosed(page);
    manifest.shots.push("nighthawk/closed-board.png");
  }

  for (const ticker of TICKERS) {
    console.log("\n===", ticker, "===");
    try {
      await captureVectorReplay(page, ticker);
      manifest.shots.push(`${ticker.toLowerCase()}/vector-replay.png`);
    } catch (e) {
      console.warn("vector", ticker, e.message);
    }
    try {
      await captureHelixReplay(page, ticker);
      manifest.shots.push(`${ticker.toLowerCase()}/helix-replay-tape.png`);
    } catch (e) {
      console.warn("helix", ticker, e.message);
    }
    try {
      await captureThermal(page, ticker);
      manifest.shots.push(`${ticker.toLowerCase()}/thermal-matrix.png`);
    } catch (e) {
      console.warn("thermal", ticker, e.message);
    }
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("\nDONE", OUT);
} finally {
  await auth.cleanup?.();
  await browser.close();
}

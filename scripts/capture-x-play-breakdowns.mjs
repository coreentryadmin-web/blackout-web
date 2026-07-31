#!/usr/bin/env node
/**
 * Per-play UI screenshots for X marketing — Night Hawk CLOSED rows + HELIX SPX tape.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = process.env.X_MARKETING_OUT || "/opt/cursor/artifacts/x-marketing-jul30";
mkdirSync(OUT, { recursive: true });

const PLAY_TICKERS = ["NBIS", "SNDK", "MU", "KORU"];

async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("Got it")',
    'button:has-text("Continue")',
    'button:has-text("Dismiss")',
    'button[aria-label="Close"]',
  ]) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function waitDeck(page) {
  await page.waitForSelector(".nh-deck", { timeout: 90000 });
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll(".nh-deck-row");
      const skel = document.querySelectorAll(".nh-deck-skel");
      return rows.length > 0 || document.querySelector(".nh-deck-empty");
    },
    { timeout: 90000 },
  );
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
  // Night Hawk 0DTE board — CLOSED filter, per-play terminal
  await page.goto(`${BASE}/nighthawk?view=0dte`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60000 });
  await dismissOverlays(page);
  await waitDeck(page);
  await page.waitForTimeout(2000);

  const closedBtn = page.locator('.nh-deck-filtbtn:has-text("CLOSED")');
  if (await closedBtn.isVisible().catch(() => false)) {
    await closedBtn.click();
    await page.waitForTimeout(800);
  }

  await page.screenshot({ path: join(OUT, "11-nighthawk-closed-board.png") });
  console.log("saved closed board");

  for (const ticker of PLAY_TICKERS) {
    const row = page.locator(".nh-deck-row").filter({ hasText: new RegExp(`^\\s*\\d+\\s*${ticker}\\b`) }).first();
    if (!(await row.isVisible().catch(() => false))) {
      const alt = page.locator(".nh-deck-row", { has: page.locator(`.nh-deck-tk:text-is("${ticker}")`) }).first();
      if (await alt.isVisible().catch(() => false)) {
        await alt.click();
      } else {
        console.warn("skip row", ticker);
        continue;
      }
    } else {
      await row.click();
    }
    await page.waitForTimeout(600);
    const terminal = page.locator(".nh-deck-right").first();
    await terminal.screenshot({ path: join(OUT, `12-nighthawk-${ticker.toLowerCase()}-terminal.png`) });
    console.log("saved terminal", ticker);
  }

  // Full deck with one play selected (NBIS — biggest MFE)
  const nbis = page.locator(".nh-deck-row", { has: page.locator('.nh-deck-tk:text-is("NBIS")') }).first();
  if (await nbis.isVisible().catch(() => false)) {
    await nbis.click();
    await page.waitForTimeout(500);
    await page.locator(".nh-deck").screenshot({ path: join(OUT, "13-nighthawk-nbis-full-deck.png") });
  }

  // HELIX — SPX whale tape
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissOverlays(page);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, "14-helix-flows-desk.png"), fullPage: false });

  const spxFilter = page.getByPlaceholder(/filter|search|ticker/i).first();
  if (await spxFilter.isVisible().catch(() => false)) {
    await spxFilter.fill("SPX");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, "15-helix-spx-filtered.png"), fullPage: false });
  }

  // Thermal — NBIS gamma if searchable
  await page.goto(`${BASE}/heatmap?ticker=NBIS`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissOverlays(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, "16-thermal-nbis.png"), fullPage: false });

  console.log("DONE", OUT);
} finally {
  await auth.cleanup?.();
  await browser.close();
}

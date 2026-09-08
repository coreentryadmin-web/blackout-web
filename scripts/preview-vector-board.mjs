#!/usr/bin/env node
/**
 * Screenshot the local Vector board preview (no auth required).
 * Requires: npm run dev on :3000
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = (process.env.VALIDATE_BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/vector-board-preview";

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const url = `${BASE}/vector-board-preview`;
  console.log(`Opening ${url}...`);
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  if (!res?.ok()) {
    console.error(`HTTP ${res?.status()} — is npm run dev running?`);
    process.exit(1);
  }

  await page.waitForSelector(".vector-board-table", { timeout: 30_000 });
  await page.waitForTimeout(800);

  await page.screenshot({ path: `${OUT}/vector-board-preview-dark.png`, fullPage: false });

  const themeBtn = page.locator(".nh-desk-theme-toggle");
  if (await themeBtn.count()) {
    await themeBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/vector-board-preview-light.png`, fullPage: false });
  }

  // Click first row for detail rail
  const row = page.locator(".vector-board-row").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/vector-board-preview-detail.png`, fullPage: false });
  }

  const stats = await page.evaluate(() => ({
    rows: document.querySelectorAll(".vector-board-row").length,
    hasPnl: !!document.querySelector("th")?.textContent?.includes("P&L"),
    hasPanel: !!document.querySelector(".vector-board-panel"),
  }));

  console.log(JSON.stringify({ url, stats, out: OUT }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

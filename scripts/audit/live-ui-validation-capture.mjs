#!/usr/bin/env node
/** One-off comprehensive live UI capture for operator review. */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { resolveChromiumPath } from "./lib/playwright-chromium-path.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/live-ui-validation-20260905";

function cookiesFromHeader(header, domain) {
  return header
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const [n, ...r] = p.split("=");
      const name = n.trim();
      return {
        name,
        value: r.join("=").trim(),
        domain,
        path: "/",
        httpOnly: name === "__session",
        secure: domain !== "localhost",
        sameSite: "Lax",
      };
    });
}

async function shot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    publicMetadata: { role: "admin", tier: "premium" },
  });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }

  const execPath = resolveChromiumPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: ["--no-sandbox"],
  });
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.5 });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, host));
  const page = await ctx.newPage();
  const captured = [];

  // SPX Slayer
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(4000);
  captured.push(await shot(page, "01-spx-slayer-dashboard"));

  // Vector bead rail
  await page.goto(`${BASE}/vector`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);
  captured.push(await shot(page, "02-vector-full"));
  const chart = page.locator("canvas").first();
  if (await chart.count()) {
    const box = await chart.boundingBox();
    if (box) {
      await page.screenshot({
        path: `${OUT}/02-vector-chart-crop.png`,
        clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 40), width: Math.min(1200, box.width + 40), height: Math.min(700, box.height + 80) },
      });
      captured.push(`${OUT}/02-vector-chart-crop.png`);
    }
  }

  // Night Hawk 0DTE
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);
  captured.push(await shot(page, "03-nighthawk-0dte"));

  // Night Hawk Swings — list
  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(4000);
  captured.push(await shot(page, "04-nighthawk-swings-list"));

  // Click first play row for detail
  const playRow = page.locator(".nh-deck-card, .PlayLifecycleCard, [class*='nh-deck-card'], tr[data-play-id]").first();
  if (await playRow.count()) {
    await playRow.click();
    await page.waitForTimeout(2000);
    captured.push(await shot(page, "05-nighthawk-swings-detail"));
  }

  // Legacy board
  await page.goto(`${BASE}/nighthawk?view=legacy`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);
  captured.push(await shot(page, "06-nighthawk-legacy"));
  const legacyRow = page.locator(".vector-board-row").first();
  if (await legacyRow.count()) {
    await legacyRow.click();
    await page.waitForTimeout(800);
    captured.push(await shot(page, "06-nighthawk-legacy-detail"));
  }

  // Largo
  await page.goto(`${BASE}/terminal`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3000);
  captured.push(await shot(page, "07-largo-terminal"));

  const report = { base: BASE, capturedAt: new Date().toISOString(), shots: captured };
  await writeFile(`${OUT}/capture-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

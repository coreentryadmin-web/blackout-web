#!/usr/bin/env node
/**
 * Live prod validation for Thermal sector compare grid (PR #2137).
 * Uses Playwright + Clerk cookie jar (same path as ios-ui-e2e).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  iosPlaywrightDevice,
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.THERMAL_GRID_E2E_DIR || "/opt/cursor/artifacts/thermal-sector-grid-e2e";
mkdirSync(OUT, { recursive: true });

const EXPECTED_PRESETS = [
  "Indices",
  "Semis",
  "AI",
  "Space",
  "Mag 7",
  "Crypto",
  "Energy",
  "Financials",
  "Biotech",
];
const REMOVED = ["Industrials", "Real Estate", "SPY / SPX / QQQ"];

const results = [];
const pass = (name, detail = "") => {
  results.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail = "") => {
  results.push({ name, pass: false, detail });
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

const auth = await mintIosPlaywrightSession({ appUrl: BASE });
if (auth.skip) {
  console.error("SKIP:", auth.reason);
  process.exit(2);
}

const { contextOptions } = iosPlaywrightDevice();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(contextOptions);
await context.addInitScript(onboardingInitScript());
await context.addCookies(auth.cookies);

const page = await context.newPage();
try {
  const url = `${BASE}/heatmap?ticker=NVDA&compare=1&compareSet=semis`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(12_000);

  if (page.url().includes("/sign-in")) {
    fail("auth:heatmap", `redirected to sign-in (${page.url()})`);
  } else {
    pass("auth:heatmap", page.url());
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  for (const label of REMOVED) {
    if (bodyText.includes(label)) fail(`removed:${label}`, "still visible in UI");
    else pass(`removed:${label}`);
  }

  const gridBtn = page.getByRole("button", { name: /^Grid$/i }).first();
  if (await gridBtn.isVisible().catch(() => false)) {
    pass("ui:grid-button");
  } else {
    fail("ui:grid-button", "Grid toggle not visible");
  }

  const sectorTrigger = page.locator(".thermal-grid-sector-picker-trigger").first();
  if (await sectorTrigger.isVisible().catch(() => false)) {
    pass("ui:sector-dropdown");
    await sectorTrigger.click();
    await page.waitForTimeout(300);
    const options = await page.locator(".thermal-grid-sector-option").allTextContents();
    for (const label of EXPECTED_PRESETS) {
      if (options.some((o) => o.includes(label))) pass(`preset:${label}`);
      else fail(`preset:${label}`, `options=${options.join("|")}`);
    }
    if (options.some((o) => /indices/i.test(o))) pass("preset:Indices");
    else fail("preset:Indices", "missing from dropdown");
    await sectorTrigger.click(); // close menu
  } else {
    // Grid mode may already be open — check rail label / ticker chips
    const rail = page.locator(".thermal-triple-desk-rail, .gex-triple-desk-rail").first();
    if (await rail.isVisible().catch(() => false)) pass("ui:compare-rail");
    else fail("ui:sector-dropdown", "dropdown or compare rail not found");
  }

  for (const t of ["NVDA", "AMD", "AVGO", "MU", "SMCI"]) {
    const chip = page.locator(".thermal-grid-ticker-chip, .gex-grid-ticker-chip").filter({ hasText: t }).first();
    const header = page.getByText(t, { exact: true }).first();
    if ((await chip.isVisible().catch(() => false)) || (await header.isVisible().catch(() => false))) {
      pass(`column:${t}`);
    } else {
      fail(`column:${t}`, "ticker not visible in grid");
    }
  }

  await page.screenshot({ path: join(OUT, "thermal-sector-grid-semis.png"), fullPage: false });

  // Switch sector to Space
  if (await sectorTrigger.isVisible().catch(() => false)) {
    await sectorTrigger.click();
    await page.locator(".thermal-grid-sector-option", { hasText: "Space" }).click();
    await page.waitForTimeout(10_000);
    if (page.url().includes("compareSet=space")) pass("url:space");
    else fail("url:space", page.url());
    if (await page.getByText("RKLB", { exact: true }).first().isVisible().catch(() => false)) pass("column:RKLB");
    else fail("column:RKLB");
    await page.screenshot({ path: join(OUT, "thermal-sector-grid-space.png"), fullPage: false });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${failed.length ? "RED" : "GREEN"} — ${results.length} checks, ${failed.length} failed ===`);
  process.exit(failed.length ? 1 : 0);
} finally {
  await browser.close();
  await auth.cleanup();
}

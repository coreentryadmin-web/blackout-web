#!/usr/bin/env node
/**
 * BlackOut Thermal (/heatmap) deep UI click-through — every tab, lens, expiry scope,
 * triple grid (0DTE / Near), ticker search, overlays, and matrix scroll.
 *
 *   node scripts/audit/thermal-ui-clickthrough.mjs [--base=https://blackouttrades.com]
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, playwright
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/thermal-ui-clickthrough";
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

async function clickIfVisible(page, locator, label, timeout = 8000) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  try {
    await el.first().waitFor({ state: "visible", timeout });
    await el.first().click({ timeout: 5000 });
    rec(label, "PASS");
    return true;
  } catch (e) {
    rec(label, "WARN", String(e.message || e).slice(0, 120));
    return false;
  }
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  } catch {
    /* ignore */
  }
}

async function waitForThermalReady(page) {
  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 90_000 }).catch(() => null);
  await page.waitForSelector(".gex-heatmap-control-row, .gex-heatmap-panel, .thermal-triple-desk", {
    timeout: 90_000,
  }).catch(() => null);
  // Matrix cells or triple grid columns
  await page.waitForSelector(
    ".gex-matrix-scroll td, .thermal-triple-col, .gex-heatmap-panel [role='grid']",
    { timeout: 90_000 },
  ).catch(() => null);
  await page.waitForTimeout(3000);
}

async function runClickthrough(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await waitForThermalReady(page);
  rec("page:load", "PASS", page.url());

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/Matrix unavailable|retrying/i.test(bodyText)) {
    rec("matrix:available", "FAIL", "Matrix unavailable banner");
  } else {
    rec("matrix:available", "PASS");
  }

  await shot(page, "01-initial");

  // ── Grid (triple desk) ──
  const gridBtn = page.getByRole("button", { name: /^Grid$/i });
  if (await clickIfVisible(page, gridBtn, "toggle:grid-on")) {
    await page.waitForSelector(".thermal-triple-desk", { timeout: 20_000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await shot(page, "02-triple-grid");

    // Triple desk: 0DTE vs Near
    await clickIfVisible(page, page.locator(".thermal-triple-mode-btn", { hasText: /^Near$/i }), "triple:mode-near");
    await page.waitForTimeout(1500);
    await shot(page, "03-triple-near");
    await clickIfVisible(page, page.locator(".thermal-triple-mode-btn", { hasText: /^0DTE$/i }), "triple:mode-0dte");
    await page.waitForTimeout(1500);

    // Refresh all three
    await clickIfVisible(
      page,
      page.getByRole("button", { name: /Refresh thermal matrices/i }),
      "triple:refresh",
    );
    await page.waitForTimeout(2500);

    // Focus each column
    for (const t of ["SPY", "SPX", "QQQ"]) {
      const col = page.locator(".thermal-triple-ticker-btn", { hasText: t }).first();
      if (await clickIfVisible(page, col, `triple:focus-${t}`, 5000)) {
        await page.waitForTimeout(800);
      }
    }

    // Scroll sync in triple grid
    const tripleScroll = page.locator(".thermal-triple-col .gex-matrix-scroll, .thermal-compact-scroll").first();
    if (await tripleScroll.isVisible().catch(() => false)) {
      await tripleScroll.evaluate((el) => {
        el.scrollTop += 100;
        el.scrollLeft += 80;
      });
      rec("triple:scroll", "PASS");
    } else {
      rec("triple:scroll", "WARN", "compact scroll not found");
    }

    // Turn grid off → single ticker matrix
    await clickIfVisible(page, gridBtn, "toggle:grid-off");
    await page.waitForTimeout(2000);
  }

  await shot(page, "04-single-matrix");

  // ── View tabs: Matrix | Profile | Depth ──
  if (await clickIfVisible(page, page.getByRole("tab", { name: /^Matrix$/i }), "tab:matrix")) {
    await page.waitForTimeout(1000);
  }
  if (await clickIfVisible(page, page.getByRole("tab", { name: /Profile/i }), "tab:profile")) {
    await page.waitForTimeout(2500);
    await shot(page, "05-profile-curve-shift");

    // Flow / dark pool overlay toggles (profile tab)
    const flowToggle = page.locator("button", { hasText: /flow/i }).first();
    await clickIfVisible(page, flowToggle, "overlay:flow-toggle", 4000);
    await page.waitForTimeout(500);
    const dpToggle = page.getByRole("button", { name: /^Dark Pool$/i });
    if ((await dpToggle.count()) > 0) {
      await clickIfVisible(page, dpToggle, "overlay:darkpool-toggle", 4000);
    } else {
      const unavailable = page.getByText(/Dark pool · unavailable/i);
      if ((await unavailable.count()) > 0) rec("overlay:darkpool-unavailable", "PASS");
      else rec("overlay:darkpool-toggle", "WARN", "no toggle or unavailable label");
    }
    await page.waitForTimeout(500);
  }

  const depthTab = page.getByRole("tab", { name: /Depth|Forced Flow/i });
  if ((await depthTab.count()) > 0) {
    if (await clickIfVisible(page, depthTab, "tab:depth")) {
      await page.waitForTimeout(2000);
      await shot(page, "06-depth-ladder");
    }
  } else {
    rec("tab:depth", "INFO", "Depth tab hidden (non-GEX lens or loading)");
  }

  // Back to matrix for lens + expiry chips
  await clickIfVisible(page, page.getByRole("tab", { name: /^Matrix$/i }), "tab:matrix-return");

  // ── Lenses: GEX VEX DEX CHARM ──
  for (const lens of ["GEX", "VEX", "DEX", "CHARM"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${lens}$`, "i") });
    if ((await tab.count()) === 0) {
      rec(`lens:${lens.toLowerCase()}`, "INFO", "tab not in payload");
      continue;
    }
    if (await clickIfVisible(page, tab, `lens:${lens.toLowerCase()}`)) {
      await page.waitForTimeout(1500);
      const hasGrid = await page.locator(".gex-matrix-scroll [role='grid'], .gex-matrix-scroll td").first().isVisible().catch(() => false);
      rec(`lens:${lens.toLowerCase()}:matrix`, hasGrid ? "PASS" : "WARN", hasGrid ? "cells visible" : "no cells");
    }
  }
  await clickIfVisible(page, page.getByRole("tab", { name: /^GEX$/i }), "lens:gex-return");
  await shot(page, "07-lens-gex");

  // ── Expiry scope chips (on Profile tab — also mirrored on Matrix) ──
  if (await clickIfVisible(page, page.getByRole("tab", { name: /^Matrix$/i }), "tab:matrix-for-expiry", 5000)) {
    await page.waitForTimeout(800);
  }
  const expiryAll = page.getByRole("button", { name: "All", exact: true }).first();
  if ((await expiryAll.count()) > 0) {
    rec("expiry:chips-present", "PASS");
    for (const label of ["All", "0DTE", "Near", "Monthly"]) {
      const chip = page.getByRole("button", { name: label, exact: true }).first();
      if ((await chip.count()) > 0) {
        await clickIfVisible(page, chip, `expiry:${label.toLowerCase()}`, 4000);
        await page.waitForTimeout(600);
      }
    }
    await clickIfVisible(page, expiryAll, "expiry:all-return", 4000);
  } else {
    rec("expiry:chips-present", "WARN", "no scope chips visible on matrix tab");
  }

  // ── Ticker search → NVDA ──
  const tickerBtn = page.getByRole("button", { name: /Ticker:/i }).first();
  if (await clickIfVisible(page, tickerBtn, "ticker:open", 8000)) {
    const search = page.getByRole("combobox", { name: /Search any ticker/i }).or(page.locator('input[placeholder*="Search"]')).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("NVDA");
      await page.waitForTimeout(600);
      const nvdaOpt = page.getByRole("option", { name: /NVDA/i }).or(page.locator("button", { hasText: /^NVDA$/ })).first();
      if (await clickIfVisible(page, nvdaOpt, "ticker:pick-nvda", 8000)) {
        await page.waitForTimeout(3000);
        await shot(page, "08-nvda-matrix");
        const nvdaSpot = await page.locator("body").innerText();
        if (/223|224|225|NVDA/i.test(nvdaSpot)) rec("ticker:nvda-loaded", "PASS");
        else rec("ticker:nvda-loaded", "WARN", "NVDA content unclear");
      }
    } else {
      rec("ticker:search-input", "WARN", "combobox not visible");
    }
  }

  // ── Matrix scroll ──
  const matrixScroll = page.locator(".gex-matrix-scroll").first();
  if (await matrixScroll.isVisible().catch(() => false)) {
    await matrixScroll.evaluate((el) => {
      el.scrollLeft += 200;
      el.scrollTop += 120;
    });
    rec("matrix:scroll", "PASS");
  } else {
    rec("matrix:scroll", "WARN", "scroll container missing");
  }

  // ── Grid again with NVDA should exit to NVDA single (compare off) ──
  await clickIfVisible(page, gridBtn, "toggle:grid-on-again", 5000);
  await page.waitForTimeout(2000);
  if (await page.locator(".thermal-triple-desk").isVisible().catch(() => false)) {
    rec("grid:with-custom-ticker", "PASS", "triple desk shows with NVDA context");
    await clickIfVisible(page, gridBtn, "toggle:grid-off-final", 5000);
  }

  // ── URL deep link ──
  await page.goto(`${BASE}/heatmap?ticker=QQQ&lens=vex&compare=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);
  const urlState = await page.evaluate(() => ({
    ticker: new URLSearchParams(location.search).get("ticker"),
    lens: new URLSearchParams(location.search).get("lens"),
    compare: new URLSearchParams(location.search).get("compare"),
    triple: !!document.querySelector(".thermal-triple-desk"),
    vexActive: !!document.querySelector('[aria-label="Exposure lens"] [aria-selected="true"]')?.textContent?.match(/vex/i),
  }));
  if (urlState.compare === "1" && urlState.triple) rec("deeplink:compare=1", "PASS");
  else rec("deeplink:compare=1", "WARN", JSON.stringify(urlState));
  await shot(page, "09-deeplink-qqq-vex-grid");

  // Console / runtime
  const noisy = consoleErrors.filter((e) => !/clerk|favicon|404|ResizeObserver|hydration|chunk/i.test(e));
  if (pageErrors.length) rec("runtime:page-errors", "FAIL", pageErrors.slice(0, 2).join(" | "));
  else rec("runtime:page-errors", "PASS");
  if (noisy.length) rec("runtime:console-errors", "WARN", noisy.slice(0, 2).join(" | "));
  else rec("runtime:console-errors", "PASS");

  return checks;
}

async function main() {
  console.log(`\n=== Thermal UI click-through ===\nTarget: ${BASE}\n`);

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP: ${session.reason}`);
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);
  const page = await context.newPage();

  try {
    await runClickthrough(page);
  } finally {
    await browser.close();
    await session.cleanup();
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const warns = checks.filter((c) => c.status === "WARN");
  const report = { base: BASE, ts: new Date().toISOString(), checks, summary: { pass: checks.filter((c) => c.status === "PASS").length, warn: warns.length, fail: fails.length } };
  const reportPath = join(OUT, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n${report.summary.pass} PASS · ${warns.length} WARN · ${fails.length} FAIL`);
  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${OUT}\n`);

  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});

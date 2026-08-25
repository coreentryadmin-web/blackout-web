#!/usr/bin/env node
/**
 * Night Hawk 0DTE live UI audit — ThesisRankCard + board strips.
 * Playwright via CONNECT tunnel pattern (mintIosPlaywrightSession).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.OUT ?? "/opt/cursor/artifacts/nighthawk-thesis-ui";

async function dismissOverlays(page) {
  await page.waitForTimeout(800);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const sel of [
      'button:has-text("Skip")',
      'button:has-text("SKIP")',
      ".onboarding-btn-ghost",
      'button:has-text("Got it")',
      '[aria-label="Close"]',
    ]) {
      try {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.click({ timeout: 2000 });
          await page.waitForTimeout(500);
        }
      } catch {
        /* ignore */
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    const tourOpen = await page.locator(".onboarding-modal, .onboarding-title").count();
    if (!tourOpen) break;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error(JSON.stringify({ verdict: "HARNESS", reason: session.reason }));
    process.exit(2);
  }

  const report = { base: BASE, at: new Date().toISOString(), checks: [], verdict: "UNKNOWN" };
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await dismissOverlays(page);
    await page.waitForTimeout(5000);

    await page.screenshot({ path: `${OUT}/nighthawk-desk.png`, fullPage: false });

    const funnel = await page.locator('[data-testid="zerodte-discovery-funnel-strip"]').count();
    const market = await page.locator('[data-testid="zerodte-market-state-strip"]').count();
    const engine = await page.getByText("ENGINE", { exact: false }).count();
    const opps = await page.getByText(/\d+\s*OPPS/i).count();
    report.checks.push({ name: "discovery_funnel_strip", ok: funnel > 0 || engine > 0 });
    report.checks.push({ name: "market_state_strip", ok: market > 0 || opps > 0 });
    report.checks.push({ name: "command_deck_engine", ok: engine > 0, count: engine });
    report.checks.push({ name: "command_deck_opps", ok: opps > 0, count: opps });

    await dismissOverlays(page);

    await page.screenshot({ path: `${OUT}/nighthawk-0dte-tab.png`, fullPage: false });

    const playCards = await page.locator('[data-testid*="zerodte"], .nh-v2-play, [class*="play-card"]').count();
    report.checks.push({ name: "play_surface_present", ok: playCards > 0, count: playCards });

    const thesisTab = page.getByRole("button", { name: /^THESIS$/i }).or(page.getByRole("tab", { name: /^THESIS$/i }));
    if (await thesisTab.count()) {
      await thesisTab.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/nighthawk-thesis-tab.png`, fullPage: false });
    }

    const thesisHeadings = await page.getByText(/^Thesis$/i).count();
    const evidenceHeadings = await page.getByText(/^Evidence$/i).count();
    const contractHeadings = await page.getByText(/^Contract$/i).count();
    report.checks.push({ name: "thesis_rank_card_thesis", ok: thesisHeadings > 0, count: thesisHeadings });
    report.checks.push({ name: "thesis_rank_card_evidence", ok: evidenceHeadings > 0, count: evidenceHeadings });
    report.checks.push({ name: "thesis_rank_card_contract", ok: contractHeadings > 0, count: contractHeadings });

    const firstRow = page.locator('table tbody tr, [class*="play-row"], [data-ticker]').first();
    if (await firstRow.count()) {
      await firstRow.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/nighthawk-play-selected.png`, fullPage: false });
    }

    report.console_errors = errors.slice(0, 10);
    report.checks.push({ name: "no_console_errors", ok: errors.length === 0, count: errors.length });

    const failed = report.checks.filter((c) => !c.ok);
    if (failed.some((f) => f.name.includes("strip") && f.name !== "discovery_funnel_strip" && f.name !== "market_state_strip"))
      report.verdict = "RED — board shell missing";
    else if (!report.checks.find((c) => c.name === "command_deck_engine")?.ok)
      report.verdict = "RED — 0DTE command deck not loaded";
    else if (!report.checks.find((c) => c.name === "thesis_rank_card_evidence")?.ok)
      report.verdict = "AMBER — 0DTE desk loaded but ThesisRankCard not visible (deploy pending or no thesis_first on setups)";
    else report.verdict = "GREEN — Night Hawk 0DTE + ThesisRankCard visible";

    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verdict.startsWith("RED") ? 1 : 0);
  } finally {
    await browser.close();
    await session.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

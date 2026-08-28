#!/usr/bin/env node
/**
 * Marketing funnel integrity audit — catches the Aug 2026 P0 class of bugs BEFORE ship.
 *
 * Repo mode (default, CI): forbidden Whop/pricing copy, price parity, plan-matrix guards.
 * Live mode (--live): prod Playwright checks for hero fold, phosphor boot, gamma loading, upgrade sync gate.
 *
 *   node scripts/audit/marketing-funnel-audit.mjs [--live] [--json] [--quiet]
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  gammaLoadingFreshnessConflict,
  homepageH1AboveFold,
  methodologyPageGate,
  scanForbiddenMarketingCopy,
  upgradeAnonSyncGate,
  whopScriptPriceParity,
} from "./lib/marketing-funnel-eval.mjs";

const LIVE = process.argv.includes("--live");
const JSON_OUT = process.argv.includes("--json");
const QUIET = process.argv.includes("--quiet");
const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");

const PRICING = { community: 49, monthly: 199, yearly: 1999 };

/** @typedef {{ stage: string, verdict: 'GREEN'|'RED'|'AMBER'|'SKIPPED', detail?: string }} Row */

/** @type {Row[]} */
const rows = [];

function log(msg) {
  if (!QUIET && !JSON_OUT) console.log(msg);
}

function add(stage, verdict, detail = "") {
  rows.push({ stage, verdict, detail });
  if (!JSON_OUT) {
    const icon = verdict === "GREEN" ? "✓" : verdict === "RED" ? "✗" : verdict === "AMBER" ? "⚠" : "·";
    log(`  ${icon} ${stage}${detail ? `: ${detail}` : ""}`);
  }
}

function repoScan() {
  log("\n=== REPO — commercial copy guards ===");
  const whop = readFileSync("scripts/whop-remodel.mjs", "utf8");
  const faq = readFileSync("src/lib/faq/content.ts", "utf8");
  const pricingPage = readFileSync("src/components/landing/RedesignPricing.tsx", "utf8");
  const combined = `${whop}\n${faq}\n${pricingPage}`;

  const forbidden = scanForbiddenMarketingCopy(combined);
  if (forbidden.length) {
    add("REPO-FORBIDDEN-COPY", "RED", forbidden.map((h) => `${h.id} (${h.match})`).join("; "));
  } else {
    add("REPO-FORBIDDEN-COPY", "GREEN", "no stale Community/$75 / excludes-SPX strings");
  }

  const missing = whopScriptPriceParity(whop, PRICING);
  if (missing.length) {
    add("REPO-WHOP-PRICES", "RED", `missing: ${missing.join(", ")}`);
  } else {
    add("REPO-WHOP-PRICES", "GREEN", "Whop script prices match canonical $49/$199/$1999");
  }

  try {
    execSync("npx tsx --test src/lib/plan-matrix.test.ts src/lib/faq/content.test.ts", {
      stdio: QUIET ? "pipe" : "inherit",
    });
    add("REPO-PLAN-MATRIX-TESTS", "GREEN", "plan-matrix + FAQ guards pass");
  } catch {
    add("REPO-PLAN-MATRIX-TESTS", "RED", "plan-matrix or FAQ test failed");
  }
}

/** Retry goto when a prior in-flight navigation races (Playwright "interrupted by another navigation"). */
async function gotoStable(page, path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}_cb=${Date.now()}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(400);
      return res;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/interrupted by another navigation/i.test(msg) || attempt >= 2) throw e;
      await page.waitForTimeout(1200);
    }
  }
  throw lastErr;
}

async function liveScan() {
  log("\n=== LIVE — public funnel (Playwright) ===");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    add("LIVE-PLAYWRIGHT", "SKIPPED", "playwright not available");
    return;
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });

  async function withPage(run) {
    const page = await ctx.newPage();
    try {
      return await run(page);
    } finally {
      await page.close();
    }
  }

  try {
    try {
      await withPage(async (page) => {
        await gotoStable(page, "/");
        await page.waitForTimeout(2500);
        const h1Top = await page.evaluate(() => {
          const h1 = document.querySelector(".hero-h h1, .rl .hero-h h1, h1");
          if (!h1) return null;
          return h1.getBoundingClientRect().top;
        });
        const fold = homepageH1AboveFold(h1Top);
        add("LIVE-HOMEPAGE-H1-FOLD", fold.ok ? "GREEN" : "RED", fold.reason);
      });
    } catch (e) {
      add("LIVE-HOMEPAGE-H1-FOLD", "RED", e instanceof Error ? e.message : String(e));
    }

    try {
      await withPage(async (page) => {
        await gotoStable(page, "/pricing");
        const phosphorOnNav = await page.locator(".pboot, .pboot-status").count();
        add(
          "LIVE-MARKETING-NO-PHOSPHOR",
          phosphorOnNav === 0 ? "GREEN" : "RED",
          phosphorOnNav ? "Phosphor boot visible on /pricing" : "no full-screen phosphor on marketing nav"
        );
      });
    } catch (e) {
      add("LIVE-MARKETING-NO-PHOSPHOR", "RED", e instanceof Error ? e.message : String(e));
    }

    try {
      await withPage(async (page) => {
        await gotoStable(page, "/tools/gamma-snapshot");
        await page.waitForTimeout(3000);
        const spxTab = page.locator('button:has-text("SPY")');
        if ((await spxTab.count()) > 0) {
          await spxTab.click();
          await page.waitForTimeout(1500);
        }
        const gammaText = await page.locator('[id="gamma-snapshot-panel"]').innerText().catch(() => "");
        const headerText = await page.locator(".rounded-2xl.border").first().innerText().catch(() => "");
        const conflict = gammaLoadingFreshnessConflict(`${headerText}\n${gammaText}`);
        add(
          "LIVE-GAMMA-LOADING",
          conflict ? "RED" : "GREEN",
          conflict ? "Loading… shown alongside freshness levels" : "loading and data mutually exclusive"
        );
      });
    } catch (e) {
      add("LIVE-GAMMA-LOADING", "RED", e instanceof Error ? e.message : String(e));
    }

    try {
      await withPage(async (page) => {
        await gotoStable(page, "/upgrade");
        await page.waitForTimeout(2000);
        const upgradeHtml = await page.content();
        const upgradeGate = upgradeAnonSyncGate(upgradeHtml);
        add(
          "LIVE-UPGRADE-ANON-SYNC",
          upgradeGate.ok ? "GREEN" : "RED",
          upgradeGate.reason
        );
      });
    } catch (e) {
      add("LIVE-UPGRADE-ANON-SYNC", "RED", e instanceof Error ? e.message : String(e));
    }

    try {
      await withPage(async (page) => {
        const methodologyRes = await gotoStable(page, "/methodology");
        const methodologyStatus = methodologyRes?.status() ?? 0;
        const methodologyHtml = await page.content();
        const methodologyGate = methodologyPageGate(methodologyHtml, methodologyStatus);
        add(
          "LIVE-METHODOLOGY-PAGE",
          methodologyGate.ok ? "GREEN" : "RED",
          methodologyGate.reason
        );
      });
    } catch (e) {
      add("LIVE-METHODOLOGY-PAGE", "RED", e instanceof Error ? e.message : String(e));
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  log(`Marketing funnel audit${LIVE ? " (live)" : " (repo)"} — ${BASE}`);
  repoScan();
  if (LIVE) await liveScan();

  const red = rows.filter((r) => r.verdict === "RED");
  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, live: LIVE, rows, red: red.length }, null, 2));
  } else {
    log(`\n=== Summary: ${rows.length - red.length}/${rows.length} green${red.length ? `, ${red.length} RED` : ""} ===`);
  }
  process.exit(red.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

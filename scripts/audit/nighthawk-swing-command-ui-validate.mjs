#!/usr/bin/env node
/**
 * Validate Night Hawk Swing Command UI:
 * - Toggle shows ONLY 0DTE / Swings / Legacy (no Bangers / Vector tabs)
 * - ?view=banger and ?view=vector land on Swings
 * - Swings tab renders Command Deck (not vector/banger table boards)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/nighthawk-swing-command-validate";
const EXPECT_THREE_TABS = process.env.EXPECT_THREE_TABS !== "0";

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

async function readNightHawkDom(page) {
  return page.evaluate(() => {
    const segment = document.querySelector(".ios-native-desk-segment, .nighthawk-feed-header");
    const buttons = [...document.querySelectorAll(".ios-native-desk-segment button, .ios-native-desk-segment [role='tab']")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const allSegmentText = segment?.textContent || "";
    return {
      url: location.href,
      segmentButtons: buttons,
      segmentText: allSegmentText,
      hasVectorBoardShell: !!document.querySelector(".vector-board-shell"),
      hasBangerBoard: !!document.querySelector(".banger-board, [data-board='banger']"),
      hasCommandDeck: !!document.querySelector(".nh-deck, .command-deck, [class*='nh-deck']"),
      hasDeckCards: document.querySelectorAll(".nh-deck-rows .nh-deck-card, .PlayLifecycleCard, [class*='nh-deck-card']").length,
      hasSectionFilter: !!document.querySelector(".nh-deck-filterbar--sections"),
      hasPlayTerminal: !!document.querySelector(".nh-deck-right, .nh-deck-terminal"),
      bodySnippet: (document.body.innerText || "").slice(0, 500),
    };
  });
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

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, host));
  const page = await ctx.newPage();

  const results = {};

  // Default nighthawk
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(4000);
  results.default = await readNightHawkDom(page);
  await page.screenshot({ path: `${OUT}/nighthawk-default.png`, fullPage: false });

  // Swings tab
  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(5000);
  results.swings = await readNightHawkDom(page);
  await page.screenshot({ path: `${OUT}/nighthawk-swings.png`, fullPage: false });

  // Legacy redirect check
  await page.goto(`${BASE}/nighthawk?view=legacy`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(3000);
  results.legacy = await readNightHawkDom(page);
  await page.screenshot({ path: `${OUT}/nighthawk-legacy.png`, fullPage: false });

  // Old banger URL should land on swings (post-unification)
  await page.goto(`${BASE}/nighthawk?view=banger`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(4000);
  results.bangerAlias = await readNightHawkDom(page);
  await page.screenshot({ path: `${OUT}/nighthawk-banger-alias.png`, fullPage: false });

  // Old vector URL
  await page.goto(`${BASE}/nighthawk?view=vector`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(4000);
  results.vectorAlias = await readNightHawkDom(page);
  await page.screenshot({ path: `${OUT}/nighthawk-vector-alias.png`, fullPage: false });

  const tabLabels = results.default.segmentButtons.length
    ? results.default.segmentButtons
    : (results.default.segmentText.match(/0DTE|Swings?|Legacy|Bangers?|Vector/gi) || []);

  const checks = {
    threeTabsOnly: EXPECT_THREE_TABS
      ? !/banger/i.test(results.default.segmentText) &&
        !/vector/i.test(results.default.segmentText) &&
        /0\s*dte|0dte/i.test(results.default.segmentText) &&
        /swing/i.test(results.default.segmentText) &&
        /legacy/i.test(results.default.segmentText)
      : true,
    noVectorBoardOnSwings: !results.swings.hasVectorBoardShell,
    noBangerBoardOnSwings: !results.swings.hasBangerBoard,
    swingsHasCommandDeck: results.swings.hasCommandDeck || results.swings.hasDeckCards > 0,
    swingsHasTerminal: results.swings.hasPlayTerminal,
    bangerAliasResolvesToSwings:
      results.bangerAlias.hasCommandDeck || results.bangerAlias.hasSectionFilter || /swing/i.test(results.bangerAlias.segmentText),
    vectorAliasResolvesToSwings:
      results.vectorAlias.hasCommandDeck || results.vectorAlias.hasSectionFilter || /swing/i.test(results.vectorAlias.segmentText),
    vectorAliasNoVectorTable: !results.vectorAlias.hasVectorBoardShell,
  };

  const report = {
    base: BASE,
    expectThreeTabs: EXPECT_THREE_TABS,
    capturedAt: new Date().toISOString(),
    tabLabels,
    results,
    checks,
    pass: Object.values(checks).every(Boolean),
  };

  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(report.pass ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

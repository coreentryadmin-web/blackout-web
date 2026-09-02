#!/usr/bin/env node
/**
 * Capture Vector + Legacy Night Hawk board screenshots on production (or VALIDATE_BASE).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/nighthawk-boards-prod";

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

async function captureBoard(page, view, label) {
  await page.goto(`${BASE}/nighthawk?view=${view}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(3000);

  const dom = await page.evaluate(() => {
    const shell = document.querySelector(".vector-board-shell, .legacy-board-shell");
    const table = document.querySelector(".vector-board-table");
    const dataBoard = document.querySelector("[data-board]")?.getAttribute("data-board") ?? null;
    const colgroup = document.querySelector("colgroup");
    const rows = document.querySelectorAll(".vector-board-row").length;
    const cards = document.querySelectorAll(".nh-deck-rows .nh-deck-card, .command-deck-card").length;
    return { hasShell: !!shell, hasTable: !!table, dataBoard, hasColgroup: !!colgroup, rows, cards };
  });

  await page.screenshot({ path: `${OUT}/prod-nighthawk-${label}.png`, fullPage: false });

  const row = page.locator(".vector-board-row").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/prod-nighthawk-${label}-detail.png`, fullPage: false });
  }

  let reasoning = null;
  if (view === "legacy" && (await row.count())) {
    reasoning = await page.evaluate(() => ({
      manageRail: !!document.querySelector(".legacy-board-manage"),
      technicalsRail: !!document.querySelector(".legacy-board-technicals"),
      whySection: !!document.querySelector(".legacy-board-technicals .legacy-detail-section-title"),
      tradePlan: document.body.textContent?.includes("Trade plan") ?? false,
    }));
    if (reasoning.technicalsRail) {
      await page.screenshot({ path: `${OUT}/prod-nighthawk-legacy-inspector.png`, fullPage: false });
    }
  }

  return { view, label, dom, reasoning };
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

  const vector = await captureBoard(page, "vector", "vector");
  const legacy = await captureBoard(page, "legacy", "legacy");

  let reasoning = null;
  if (legacy.dom.hasTable) {
    const row = page.locator(".vector-board-row").first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(600);
      reasoning = await page.evaluate(() => ({
        manageRail: !!document.querySelector(".legacy-board-manage"),
        technicalsRail: !!document.querySelector(".legacy-board-technicals"),
        whySection: !!document.querySelector(".legacy-board-technicals .legacy-detail-section-title"),
        tradePlan: document.body.textContent?.includes("Trade plan") ?? false,
      }));
    }
  }

  const report = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    vector,
    legacy,
    deployed:
      legacy.dom.dataBoard === "legacy-xads-table" && vector.dom.hasTable && legacy.dom.hasTable,
    legacyReasoningLive:
      legacy.reasoning?.technicalsRail === true &&
      legacy.reasoning?.manageRail === true &&
      legacy.reasoning?.tradePlan === true,
  };
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  const ok = report.deployed && report.legacyReasoningLive;
  process.exit(ok ? 0 : report.deployed ? 2 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

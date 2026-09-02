#!/usr/bin/env node
/**
 * Legacy board UI audit — dual-rail inspector, field presence, no page scroll.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/legacy-board-ui-audit";

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

  await page.goto(`${BASE}/nighthawk?view=legacy`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2500);

  const beforeSelect = await page.evaluate(() => ({
    dataBoard: document.querySelector("[data-board]")?.getAttribute("data-board"),
    rowCount: document.querySelectorAll(".vector-board-row").length,
    pageScrollY: window.scrollY,
    shellClass: document.querySelector(".legacy-board-shell")?.className ?? "",
  }));

  await page.screenshot({ path: `${OUT}/legacy-board-before-select.png`, fullPage: false });

  const row = page.locator(".vector-board-row").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(800);
  }

  const afterSelect = await page.evaluate(() => {
    const shell = document.querySelector(".legacy-board-shell");
    const body = document.body;
    return {
      inspectorMode: shell?.classList.contains("legacy-board-shell--inspector") ?? false,
      manageRail: !!document.querySelector(".legacy-board-manage"),
      technicalsRail: !!document.querySelector(".legacy-board-technicals"),
      tradePlan: body.textContent?.includes("Trade plan") ?? false,
      whyPicked: body.textContent?.includes("Why we picked it") ?? false,
      scoringFactors: body.textContent?.includes("Scoring factors") ?? false,
      levelsSection: body.textContent?.includes("Levels to manage") ?? false,
      pageScrollY: window.scrollY,
      bodyScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      sectionTitles: [...document.querySelectorAll(".legacy-detail-section-title")].map((el) => el.textContent?.trim()),
      bulletCount: document.querySelectorAll(".legacy-detail-bullet").length,
    };
  });

  await page.screenshot({ path: `${OUT}/legacy-board-inspector.png`, fullPage: false });

  // Search interaction
  const search = page.locator(".vector-board-search-input");
  if (await search.count()) {
    await search.fill("M");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/legacy-board-search.png`, fullPage: false });
    await search.fill("");
  }

  const verdict =
    beforeSelect.dataBoard !== "legacy-xads-table"
      ? "RED — legacy-xads-table marker missing"
      : beforeSelect.rowCount === 0
        ? "AMBER — no plays to inspect"
        : !afterSelect.inspectorMode
          ? "RED — inspector mode not active on row select"
          : !afterSelect.manageRail || !afterSelect.technicalsRail
            ? "RED — dual rails missing"
            : !afterSelect.tradePlan || !afterSelect.whyPicked
              ? "RED — manage/technicals content missing"
              : afterSelect.pageScrollY > 12
                ? "AMBER — page scrolls (target: viewport-locked)"
                : afterSelect.bulletCount < 8
                  ? "AMBER — sparse bullet content"
                  : "GREEN — Legacy dual-rail inspector live";

  const report = { base: BASE, beforeSelect, afterSelect, verdict };
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(verdict.startsWith("GREEN") ? 0 : verdict.startsWith("AMBER") ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

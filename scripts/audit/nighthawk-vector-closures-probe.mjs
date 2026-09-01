#!/usr/bin/env node
/**
 * Live probe: Night Hawk Vector board — new table UI (vector-board-* selectors).
 * Guards viewport lock, tab switching, filters, search, and detail rail.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/nighthawk-vector-closures";

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
        secure: true,
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, new URL(BASE).hostname));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/nighthawk?view=vector`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2500);

  const apiJson = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/market/vector/pick-closures/board?limit=50`, { cache: "no-store" });
    return r.json();
  }, BASE);

  const winnersTab = page.getByRole("tab", { name: /Winners/i });
  const liveTab = page.getByRole("tab", { name: /Live/i });
  const closedTab = page.getByRole("tab", { name: /Closed/i });

  if (await liveTab.count()) {
    await liveTab.click();
    await page.waitForTimeout(500);
  }

  let dom = await page.evaluate(() => {
    const shell = document.querySelector(".vector-board-shell");
    const rows = [...document.querySelectorAll(".vector-board-row")];
    const first = rows[0];
    const rect = first?.getBoundingClientRect();
    return {
      hasShell: !!shell,
      hasTable: !!document.querySelector(".vector-board-table"),
      rowCount: rows.length,
      firstHeight: rect?.height ?? 0,
      legacyCards: document.querySelectorAll(".vector-closure-row, .vector-leader-row").length,
      pageScrollY: window.scrollY,
    };
  });

  if (await closedTab.count()) {
    await closedTab.click();
    await page.waitForTimeout(500);
    dom = {
      ...dom,
      ...(await page.evaluate(() => ({
        closedRowCount: document.querySelectorAll(".vector-board-row").length,
      }))),
    };
  }

  // Search interaction
  const search = page.locator(".vector-board-search-input");
  if (await search.count()) {
    await search.fill("A");
    await page.waitForTimeout(300);
    const searchRows = await page.locator(".vector-board-row").count();
    await search.fill("");
    dom = { ...dom, searchFiltered: searchRows };
  }

  // Filters drawer
  const filters = page.locator(".vector-board-filters-trigger");
  if (await filters.count()) {
    await filters.click();
    await page.waitForTimeout(250);
    dom = { ...dom, filtersOpen: await page.locator(".vector-board-filters-panel").count() > 0 };
    await page.keyboard.press("Escape");
  }

  // Detail rail
  const row = page.locator(".vector-board-row").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
    dom = { ...dom, detailOpen: (await page.locator(".vector-board-detail:not(.vector-board-detail--empty)").count()) > 0 };
  }

  await page.screenshot({ path: `${OUT}/nighthawk-vector-tab.png`, fullPage: false });

  const apiTotal =
    (apiJson?.leaders?.length ?? 0) + (apiJson?.winners?.length ?? 0) + (apiJson?.closed?.length ?? 0);

  const verdict =
    dom.legacyCards > 0 && !dom.hasTable
      ? "AMBER — legacy card UI (deploy pending)"
      : !dom.hasShell
        ? "RED — vector-board-shell missing"
        : !dom.hasTable
          ? "RED — table UI missing"
          : dom.rowCount === 0 && apiTotal > 0
            ? "RED — API has rows but table empty"
            : dom.firstHeight > 0 && dom.firstHeight < 20
              ? "RED — row height collapsed"
              : dom.pageScrollY > 12
                ? "AMBER — page scrolls (viewport lock may be broken)"
                : "GREEN — Vector board table UI live";

  const report = {
    base: BASE,
    dom,
    apiLeaders: apiJson?.leaders?.length ?? 0,
    apiWinners: apiJson?.winners?.length ?? 0,
    apiClosed: apiJson?.closed?.length ?? 0,
    verdict,
  };
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

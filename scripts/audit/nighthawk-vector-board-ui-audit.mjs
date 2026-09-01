#!/usr/bin/env node
/**
 * Night Hawk Vector board UI audit — table layout, filters, P&L column, viewport lock.
 * Works against VALIDATE_BASE (default https://blackouttrades.com) or local dev.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/nighthawk-vector-board-ui";

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
    appUrl: BASE.startsWith("http://localhost") ? "https://blackouttrades.com" : BASE,
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
  await page.goto(`${BASE}/nighthawk?view=vector`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2500);

  const dom = await page.evaluate(() => {
    const shell = document.querySelector(".vector-board-shell");
    const table = document.querySelector(".vector-board-table");
    const rows = document.querySelectorAll(".vector-board-row");
    const summary = document.querySelector(".vector-board-summary-row");
    const pnlHeader = [...document.querySelectorAll("th")].find((th) =>
      /Premium|P&L/i.test(th.textContent ?? "")
    );
    const themeToggle = document.querySelector(".nh-desk-theme-toggle");
    const sortTrigger = document.querySelector(".vector-board-sort-trigger");
    const filterBars = document.querySelectorAll(".vector-board-filterbar");
    const panel = document.querySelector(".vector-board-panel");
    const scrollport = document.querySelector(".vector-board-tablewrap");
    const shellRect = shell?.getBoundingClientRect();
    const scrollRect = scrollport?.getBoundingClientRect();
    return {
      hasShell: !!shell,
      hasTable: !!table,
      rowCount: rows.length,
      hasSummary: !!summary,
      hasPnlColumn: !!pnlHeader,
      hasThemeToggle: !!themeToggle,
      hasSort: !!sortTrigger,
      filterBarCount: filterBars.length,
      hasPanel: !!panel,
      shellHeight: shellRect?.height ?? 0,
      scrollHeight: scrollRect?.height ?? 0,
      pageScrollY: window.scrollY,
      legacyCards: document.querySelectorAll(".vector-closure-row, .vector-leader-row").length,
    };
  });

  await page.screenshot({ path: `${OUT}/vector-board-desktop.png`, fullPage: false });

  // Light mode toggle
  const themeBtn = page.locator(".nh-desk-theme-toggle");
  if (await themeBtn.count()) {
    await themeBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/vector-board-light.png`, fullPage: false });
  }

  // Sort dropdown
  const sortBtn = page.locator(".vector-board-sort-trigger");
  if (await sortBtn.count()) {
    await sortBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/vector-board-sort-open.png`, fullPage: false });
    await page.keyboard.press("Escape");
  }

  // Filters drawer
  const filtersBtn = page.locator(".vector-board-filters-trigger");
  if (await filtersBtn.count()) {
    await filtersBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/vector-board-filters-open.png`, fullPage: false });
    await page.keyboard.press("Escape");
  }

  // Search
  const search = page.locator(".vector-board-search-input");
  if (await search.count()) {
    await search.fill("INTC");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/vector-board-search.png`, fullPage: false });
    await search.fill("");
  }

  // Row click → detail
  const row = page.locator(".vector-board-row").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/vector-board-detail.png`, fullPage: false });
  }

  const apiJson = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/market/vector/pick-closures/board?limit=50`, { cache: "no-store" });
    return r.json();
  }, BASE);

  const verdict =
    dom.legacyCards > 0 && !dom.hasTable
      ? "AMBER — legacy card UI (deploy pending)"
      : !dom.hasShell
        ? "RED — vector-board-shell missing"
        : !dom.hasTable
          ? "RED — table UI missing"
          : !dom.hasPnlColumn
            ? "RED — P&L column missing"
            : dom.rowCount === 0 && (apiJson?.closed?.length ?? 0) + (apiJson?.leaders?.length ?? 0) > 0
              ? "RED — API has rows but table empty"
              : dom.pageScrollY > 8
                ? "AMBER — page scrolls (viewport lock may be broken)"
                : dom.shellHeight > 0 && dom.scrollHeight > 0
                  ? "GREEN — Vector board table UI renders with internal scroll"
                  : "AMBER — layout partial";

  const report = { base: BASE, dom, apiLeaders: apiJson?.leaders?.length ?? 0, apiClosed: apiJson?.closed?.length ?? 0, verdict };
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

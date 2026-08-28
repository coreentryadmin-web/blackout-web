#!/usr/bin/env node
/**
 * Live probe: Night Hawk Vector tab closed pick rows — height + DOM classes.
 * Guards the #3053 flex-shrink collapse (blank ~26px green strips while API has rows).
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, new URL(BASE).hostname));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/nighthawk?view=vector`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2000);

  const winnersBtn = page.getByRole("button", { name: /Winners/i });
  const closedBtn = page.getByRole("button", { name: /Closed/i });
  const hasWinnersTab = (await winnersBtn.count()) > 0;

  if (hasWinnersTab) {
    await winnersBtn.first().click();
    await page.waitForTimeout(600);
  }

  // Verify closed rows render on the Closed tab (labels include counts, e.g. "Closed (47)").
  if (await closedBtn.count()) {
    await closedBtn.first().click();
    await page.waitForTimeout(600);
  }

  const tabState = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("button")].filter((b) =>
      /^(Winners|Live|Closed)(\s*\(\d+\))?$/i.test(b.textContent?.trim() ?? "")
    );
    return tabs.map((b) => ({ label: b.textContent?.trim(), pressed: b.getAttribute("aria-pressed") }));
  });

  const apiJson = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/market/vector/pick-closures/board`, { cache: "no-store" });
    return r.json();
  }, BASE);

  const dom = await page.evaluate(() => {
    const scrollport = document.querySelector(".nh-deck-rows");
    const closureRows = [...document.querySelectorAll(".vector-closure-row")];
    const leaderRows = [...document.querySelectorAll(".vector-leader-row")];
    const rows = leaderRows.length ? leaderRows : closureRows;
    const first = rows[0];
    const rect = first?.getBoundingClientRect();
    const style = first ? getComputedStyle(first) : null;
    return {
      scrollportClass: scrollport?.className ?? null,
      rowCount: rows.length,
      leaderRowCount: leaderRows.length,
      closureRowCount: closureRows.length,
      firstText: first?.innerText?.slice(0, 200) ?? null,
      firstHeight: rect?.height ?? 0,
      firstFlexShrink: style?.flexShrink ?? null,
    };
  });

  await page.screenshot({ path: `${OUT}/nighthawk-vector-tab.png`, fullPage: false });

  const hasFlexCol = dom.scrollportClass?.includes("flex-col") ?? false;
  const boardHasLeaders = Array.isArray(apiJson?.leaders);
  const report = {
    base: BASE,
    apiClosedCount: apiJson?.closed?.length ?? 0,
    apiLeadersCount: apiJson?.leaders?.length ?? 0,
    apiWinnersCount: apiJson?.winners?.length ?? 0,
    boardHasLeaders,
    tabState,
    dom,
    verdict:
      !boardHasLeaders && (apiJson?.closed?.length ?? 0) > 0
        ? "AMBER — legacy board API (deploy rolling or pending)"
        : dom.rowCount === 0 && (apiJson?.closed?.length ?? 0) > 0 && !hasWinnersTab
          ? "RED — API has rows but DOM empty"
          : hasFlexCol
            ? "RED — flex-col on scrollport (regression)"
            : dom.rowCount > 0 && dom.firstHeight < 60
              ? "RED — rows collapsed (layout bug)"
              : boardHasLeaders && hasWinnersTab && dom.closureRowCount > 0
                ? "GREEN — winners board + tabs shipped, closed rows render"
                : boardHasLeaders && hasWinnersTab
                  ? "GREEN — winners board + tabs shipped"
                  : dom.rowCount > 0
                    ? "GREEN — closure rows render full height"
                    : "AMBER — no picks visible today",
  };

  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(report.verdict.startsWith("GREEN") ? 0 : report.verdict.startsWith("AMBER") ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

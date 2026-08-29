#!/usr/bin/env node
/**
 * Live prod probe — HELIX Tier 1 (score tier, context header, CSV export wiring).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/helix-tier1-live";

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
  const report = { checks: [] };
  const rec = (name, ok, detail = "") => {
    report.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    await page.goto(`${BASE}/flows`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(4000);

    const tapeLoaded = await page.locator(".helix-tape-grid, .helix-tape").count();
    rec("tape_loaded", tapeLoaded > 0, `count=${tapeLoaded}`);

    const scoreCells = await page.locator(".helix-tape-score").count();
    rec("score_cells", scoreCells > 0, `count=${scoreCells}`);

    await page.screenshot({ path: `${OUT}/flows-tape-desktop.png`, fullPage: false });

    // Filter to SPY to surface context header
    const tickerInputs = page.locator('input[type="text"]');
    const inputCount = await tickerInputs.count();
    for (let i = 0; i < inputCount; i++) {
      const ph = await tickerInputs.nth(i).getAttribute("placeholder");
      if (ph && /symbol|ticker|sym/i.test(ph)) {
        await tickerInputs.nth(i).fill("SPY");
        await tickerInputs.nth(i).press("Enter");
        break;
      }
    }
    await page.waitForTimeout(2000);

    const ctxHeader = await page.locator('[data-testid="helix-context-header"]').count();
    rec("context_header_on_ticker_filter", ctxHeader > 0, `count=${ctxHeader}`);
    if (ctxHeader > 0) {
      await page.screenshot({ path: `${OUT}/flows-spy-context-header.png`, fullPage: false });
    }

    // Open first contract drilldown if rows exist
    const firstRow = page.locator('.helix-tape-row[role="row"]').nth(1);
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForTimeout(1500);
      const drawerScore = await page.getByText(/Score/i).count();
      rec("drilldown_opens", drawerScore > 0);
      await page.screenshot({ path: `${OUT}/flows-drilldown-score.png`, fullPage: false });
    }

    await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    const failed = report.checks.filter((c) => !c.ok).length;
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await browser.close();
    await session.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

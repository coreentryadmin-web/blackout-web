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

  const apiJson = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/market/vector/pick-closures/board`, { cache: "no-store" });
    return r.json();
  }, BASE);

  const dom = await page.evaluate(() => {
    const scrollport = document.querySelector(".nh-deck-rows");
    const rows = [...document.querySelectorAll(".vector-closure-row")];
    const first = rows[0];
    const rect = first?.getBoundingClientRect();
    const style = first ? getComputedStyle(first) : null;
    return {
      scrollportClass: scrollport?.className ?? null,
      rowCount: rows.length,
      firstText: first?.innerText?.slice(0, 200) ?? null,
      firstHeight: rect?.height ?? 0,
      firstFlexShrink: style?.flexShrink ?? null,
    };
  });

  await page.screenshot({ path: `${OUT}/nighthawk-vector-tab.png`, fullPage: false });

  const hasFlexCol = dom.scrollportClass?.includes("flex-col") ?? false;
  const report = {
    base: BASE,
    apiClosedCount: apiJson?.closed?.length ?? 0,
    dom,
    verdict:
      dom.rowCount === 0 && (apiJson?.closed?.length ?? 0) > 0
        ? "RED — API has rows but DOM empty"
        : hasFlexCol
          ? "RED — flex-col on scrollport (regression)"
          : dom.rowCount > 0 && dom.firstHeight < 60
            ? "RED — rows collapsed (layout bug)"
            : dom.rowCount > 0
              ? "GREEN — closure rows render full height"
              : "AMBER — no closed picks today",
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

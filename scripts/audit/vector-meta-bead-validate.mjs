#!/usr/bin/env node
/**
 * Post-deploy META bead validation — wall-history rank coverage + live Vector UI screenshot.
 * Requires CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  trailsByStrike,
  DOMINANT_WALLS_PER_BUCKET,
} from "../../src/features/vector/lib/vector-wall-history.ts";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_META_DIR || "/opt/cursor/artifacts/vector-meta-bead-validate";
mkdirSync(OUT, { recursive: true });

function etSessionYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function topRanked(walls, side, n) {
  const rows = walls?.[side] ?? [];
  return [...rows]
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, n)
    .map((w) => ({ strike: Math.round(w.strike), pct: w.pct }));
}

async function main() {
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }
  const cookieHeader = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const report = {
    base: BASE,
    session: etSessionYmd(),
    dominantCap: DOMINANT_WALLS_PER_BUCKET,
    deployNote: "Client bundle uses DOMINANT_WALLS_PER_BUCKET from build — expect 6 post #2826",
    api: null,
    ui: null,
    verdict: "PENDING",
  };

  try {
    const url = `${BASE}/api/market/vector/wall-history?ticker=META&session=${report.session}&horizon=weekly`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    const body = await res.json().catch(() => ({}));
    const history = Array.isArray(body?.history) ? body.history : [];
    const latest = history[history.length - 1];
    const callTrails = trailsByStrike(history, "callWalls", "gex");
    const callStrikes = [...callTrails.keys()].sort((a, b) => a - b);
    const top6 = latest?.walls ? topRanked(latest.walls, "callWalls", 6) : [];
    const top5 = latest?.walls ? topRanked(latest.walls, "callWalls", 5) : [];
    const rank6Only = top6.filter((w) => !top5.some((x) => x.strike === w.strike));

    report.api = {
      status: res.status,
      samples: history.length,
      callTrailStrikes: callStrikes,
      latestTop6: top6,
      rank6StrikesWithTrails: rank6Only.filter((w) => callTrails.has(w.strike)).map((w) => w.strike),
      rank6StrikesMissingTrails: rank6Only.filter((w) => !callTrails.has(w.strike)).map((w) => w.strike),
    };

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 200));
    });
    await page.goto(`${BASE}/vector?ticker=META`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);
    const skipTour = page.getByRole("button", { name: /^skip$/i });
    if (await skipTour.count()) {
      await skipTour.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(9000);
    const shot = join(OUT, "meta-vector-beads-post-deploy.png");
    await page.screenshot({ path: shot, fullPage: false });
    const beadMarkers = await page.locator(".tv-lightweight-charts").count();
    report.ui = {
      url: `${BASE}/vector?ticker=META`,
      screenshot: shot,
      chartShells: beadMarkers,
      consoleErrors: errors.slice(0, 5),
    };
    await browser.close();

    const capOk = DOMINANT_WALLS_PER_BUCKET === 6;
    const apiOk = res.status === 200 && history.length > 0;
    const rank6Ok =
      report.api.rank6StrikesMissingTrails.length === 0 ||
      (rank6Only.length === 0 && callStrikes.length >= 5);
    report.verdict = capOk && apiOk && rank6Ok ? "GREEN" : capOk && apiOk ? "AMBER" : "RED";

    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verdict === "RED" ? 1 : 0);
  } finally {
    await session.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

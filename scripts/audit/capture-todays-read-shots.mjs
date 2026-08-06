#!/usr/bin/env node
/**
 * Marketing shots for the "Today's read" X post — captures the two hero
 * screenshots from live prod (signed in as a temp admin+premium user):
 *
 *   1. Dashboard regime card + SPX overview (the current read + playbook)
 *   2. Vector SPX intraday chart (the tape playing out the read)
 *
 * Output → /tmp/marketing-shots/todays-read/*.png
 *
 * READ-ONLY. Temp Clerk user deleted in `finally` (cleanup best-effort).
 * Never used for automated E2E — this is a one-shot marketing capture.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";

const BASE = "https://blackouttrades.com";
const OUT_DIR = "/tmp/marketing-shots/todays-read";
mkdirSync(OUT_DIR, { recursive: true });

// Desktop viewport (not iOS) — landing/marketing pages read best wide, and
// the regime card + Vector chart both use the full-width desktop layout.
const VIEWPORT = { width: 1440, height: 900 };
const NAV_TIMEOUT = 45_000;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function shot(page, name, { fullPage = false, clip } = {}) {
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage, clip });
  log(`saved ${path}`);
  return path;
}

async function main() {
  log("Minting Clerk premium session…");
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(1);
  }
  log(`session minted — cookies=${session.cookies.length}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2, // 2x = retina-crisp screenshots suitable for social
      colorScheme: "dark", // BlackOut is dark-only; ensures the dark theme
    });
    await context.addCookies(session.cookies);
    const page = await context.newPage();

    // ============================================================
    // Shot 1 — DASHBOARD (regime + SPX overview)
    // ============================================================
    log("Navigating to /dashboard …");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    // Give live data / SSE / regime card a moment to populate above the fold.
    await page.waitForTimeout(6000);

    // Full-page shot first (captures everything on the dashboard for backup).
    await shot(page, "01-dashboard-full", { fullPage: true });

    // Above-the-fold hero shot — regime card + chart headline. Landscape crop
    // matches X's preferred aspect ratio (16:9 area doesn't get cropped in-feed).
    await shot(page, "01-dashboard-hero", {
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    // ============================================================
    // Shot 2 — VECTOR (SPX intraday tape)
    // ============================================================
    log("Navigating to /vector (SPX default) …");
    await page.goto(`${BASE}/vector`, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    // Vector's chart + wall structure needs time to render (WS-backed via SSE).
    await page.waitForTimeout(8000);

    await shot(page, "02-vector-full", { fullPage: true });
    await shot(page, "02-vector-hero", {
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    // ============================================================
    // Shot 3 — LIVE SPX chart (SPX Slayer / dashboard chart zoomed)
    // ============================================================
    // Some layouts have the intraday chart on /dashboard already; if not
    // separately hosted, /vector shot above is our chart hero.

    log("Done. Files under " + OUT_DIR);
  } finally {
    await browser.close();
    if (typeof session.cleanup === "function") {
      log("Cleaning up temp Clerk user…");
      await session.cleanup().catch(() => {});
    }
  }
}

try {
  await main();
} catch (err) {
  console.error("FATAL:", err);
  process.exit(1);
}

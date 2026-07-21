#!/usr/bin/env node
/**
 * Focused screenshot of the Vector chart bead rail — to show the new Wall Integrity Rings
 * (firm/moderate/thin halo channel). Mints a temp Clerk admin+premium user, loads /vector on a
 * high-DPI desktop viewport, waits for the bead rail to render on the (default) GEX lens, and
 * captures a full-page shot + a cropped chart shot. Always deletes the temp user.
 *
 * Requires CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Run with the AWS proxy env
 * untouched (no AWS needed here). Screenshots land in SHOT_DIR (default scratchpad).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const TICKER = process.env.RINGS_TICKER || "SPX";
const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/tmp/claude-0/-home-user/4e81061a-28b0-5b7a-b55b-1ebd214f8951/scratchpad/rings-shots";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

mkdirSync(SHOT_DIR, { recursive: true });

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function main() {
  const pw = await mintIosPlaywrightSession({ appUrl: BASE });
  if (pw.skip) throw new Error(`auth skipped: ${pw.reason}`);
  console.log("✓ minted temp admin+premium Clerk session");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: DESKTOP_UA,
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(pw.cookies);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  const shots = [];
  try {
    // Try a ticker-scoped URL first; fall back to the default /vector if the route ignores it.
    const url = `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });
    console.log("✓ signed in, /vector loaded");

    await page
      .locator(".vector-page-shell, .vector-chart-wrap")
      .first()
      .waitFor({ timeout: 30_000 });
    const chart = page.locator(".vector-chart-canvas").first();
    await chart.waitFor({ state: "visible", timeout: 30_000 });
    console.log("✓ chart canvas visible");

    // Let SWR pull wall history + walls and let the bead rail paint (GEX lens is default → rings on).
    await page.waitForTimeout(14_000);

    const full = join(SHOT_DIR, `vector-rings-full-${stamp()}.png`);
    await page.screenshot({ path: full, fullPage: true });
    shots.push(full);
    console.log(`✓ full-page: ${full}`);

    // Cropped chart shot for bead-ring clarity.
    const wrap = page.locator(".vector-chart-wrap, .vector-chart").first();
    const crop = join(SHOT_DIR, `vector-rings-chart-${stamp()}.png`);
    await wrap.screenshot({ path: crop });
    shots.push(crop);
    console.log(`✓ chart crop: ${crop}`);

    if (consoleErrors.length) {
      const real = consoleErrors.filter((e) => !/favicon|ResizeObserver|clerk/i.test(e));
      if (real.length) console.log(`⚠ ${real.length} console error(s):`, real.slice(0, 3));
    }
  } finally {
    await browser.close().catch(() => {});
    if (pw.cleanup) await pw.cleanup();
    console.log("✓ temp user deleted");
  }
  console.log("SHOTS:", JSON.stringify(shots));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

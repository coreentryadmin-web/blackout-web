#!/usr/bin/env node
/**
 * SPX Slayer-only high-DPI screenshots for manual X posts.
 *
 * Quality settings:
 *   - viewport 1920×1080, deviceScaleFactor 2 → ~3840×2160 effective PNG
 *   - animations disabled, panel clipped to on-screen bounds (no blurry full-page downscale)
 *   - waits for live matrix rows + play rail before shutter
 *
 * Output: /opt/cursor/artifacts/x-posts/spx-slayer/
 *
 * Usage:
 *   node --import tsx scripts/audit/spx-slayer-x-capture.mjs
 *   node --import tsx scripts/audit/spx-slayer-x-capture.mjs --lens vex
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";
import { prepareVectorShowcaseChart, waitForSpxDeskReady } from "./lib/vector-showcase-prep.mjs";
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";

const BASE = "https://blackouttrades.com";
const OUT = "/opt/cursor/artifacts/x-posts/spx-slayer";
const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const LENS = opt("lens", "gex").toLowerCase();

const VIEWPORT = { width: 1920, height: 1080 };
const DEVICE_SCALE = 2;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, target, context, opts = {}) {
  assertCapturableUrl(page.url(), context);
  return (target ?? page).screenshot({
    type: "png",
    animations: "disabled",
    caret: "hide",
    timeout: 90_000,
    ...opts,
  });
}

/** Element-bound PNG — sharper than page clip for scrollable panels. */
async function shotElement(locator, context) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 60_000 });
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await sleep(600);
  return el.screenshot({ type: "png", animations: "disabled", timeout: 90_000 });
}

/** Clip visible viewport region of a panel — avoids capturing 4000px scroll height shrunk by X. */
async function shotPanel(page, locator, context, maxH = 1000, minH = 80) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 60_000 });
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await sleep(600);
  const clip = await el.evaluate((node, h) => {
    const r = node.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.min(Math.floor(r.width), 1880),
      height: Math.min(Math.floor(r.height), h),
    };
  }, maxH);
  if (clip.width < 80 || clip.height < minH) {
    throw new Error(`${context}: panel clip too small ${JSON.stringify(clip)}`);
  }
  return shot(page, null, context, { clip });
}

async function dismissOverlays(page) {
  for (let pass = 0; pass < 4; pass++) {
    let dismissed = false;
    for (const sel of [
      'button:has-text("SKIP")',
      'button:has-text("Skip")',
      'button:has-text("Got it")',
      'button:has-text("Continue")',
      'button:has-text("Dismiss")',
      '[aria-label="Close"]',
    ]) {
      try {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.click({ timeout: 2000, force: true });
          dismissed = true;
          await sleep(500);
        }
      } catch {
        /* ignore */
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    if (!dismissed) break;
  }
}

async function waitForDeskReady(page) {
  await waitForSpxDeskReady(page);
  await sleep(1000);
}

async function setMatrixLens(page, lens) {
  const isVex = lens === "vex";
  const tab = page.locator(isVex ? "#spx-matrix-tab-vex" : "#spx-matrix-tab-gex").first();
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  if ((await tab.getAttribute("aria-selected")) === "true") {
    await sleep(800);
    return;
  }
  await dismissOverlays(page);
  await tab.click({ force: true });
  await sleep(2500);
}

async function save(name, buf, meta) {
  const path = join(OUT, name);
  writeFileSync(path, buf);
  console.log(`  ✓ ${path} (${buf.length} bytes) — ${meta}`);
  return { name, path, bytes: buf.length, label: meta };
}

async function main() {
  console.log(`[spx-slayer-x-capture] lens=${LENS} scale=${DEVICE_SCALE}x viewport=${VIEWPORT.width}×${VIEWPORT.height}`);

  const auth = await mintIosPlaywrightSession({ appUrl: BASE });
  if (auth.skip) throw new Error(auth.reason ?? "Clerk auth unavailable");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    colorScheme: "dark",
  });
  if (auth.cookies?.length) await ctx.addCookies(auth.cookies);
  await ctx.addInitScript(onboardingInitScript());

  const page = await ctx.newPage();
  const captured = [];

  try {
    console.log("→ /dashboard");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await waitForDeskReady(page);
    await setMatrixLens(page, LENS);

    // 1 — Full desk (shows matrix + play rail + stats — best "product" shot)
    captured.push(
      await save(
        "01-full-desk.png",
        await shotPanel(page, page.locator(".spx-sniper-desk"), "SPX Slayer full desk", 1040),
        "Full desk — matrix, play rail, session stats",
      ),
    );

    // 2 — GEX/VEX matrix panel only (nodes / strikes — best for "what to watch" posts)
    captured.push(
      await save(
        `02-matrix-${LENS}.png`,
        await shotElement(page.locator(".spx-gex-matrix-heatmap"), `SPX matrix ${LENS.toUpperCase()}`),
        `${LENS.toUpperCase()} matrix — strike ladder + spot row`,
      ),
    );

    // 3 — SPX play verdict (EOD pin + play engine read)
    const playPanel = page.locator(".spx-left-pin-stack, .spx-play-verdict-bar").first();
    if (await playPanel.count()) {
      captured.push(
        await save(
          "03-play-verdict.png",
          await shotElement(playPanel, "SPX play verdict"),
          "Play verdict + EOD pin forecaster",
        ),
      );
    }

    // 3b — Embedded SPX Vector chart (showcase: 3m · 0DTE · 20 rows · VP + beads)
    const vectorCol = page.locator(".spx-sniper-vector-col").first();
    if (await vectorCol.count()) {
      await prepareVectorShowcaseChart(page);
      captured.push(
        await save(
          "03b-vector-chart.png",
          await shotElement(page.locator(".vector-chart-stage"), "SPX Vector chart stage"),
          "SPX Vector — beads + volume profile showcase",
        ),
      );
      captured.push(
        await save(
          "03c-vector-chart-column.png",
          await shotElement(vectorCol, "SPX Vector column"),
          "SPX Vector column — matrix context + chart",
        ),
      );
    }

    // 4 — Session stats strip (spot, vix, regime pills — compact hook image)
    const stats = page.locator(".spx-desk-top-stats--strip, .spx-desk-top-stats").first();
    if (await stats.count()) {
      captured.push(
        await save(
          "04-session-stats.png",
          await shotPanel(page, stats, "SPX session stats", 120, 40),
          "Session stats strip — spot / VIX / regime",
        ),
      );
    }

    // 5 — Optional second lens for comparison pack
    if (LENS === "gex") {
      await setMatrixLens(page, "vex");
      captured.push(
        await save(
          "05-matrix-vex.png",
          await shotElement(page.locator(".spx-gex-matrix-heatmap"), "SPX matrix VEX"),
          "VEX matrix — vol-exposure lens",
        ),
      );
    }

    const manifest = {
      product: "SPX Slayer",
      route: "/dashboard",
      capturedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
      effectiveMaxPx: `${VIEWPORT.width * DEVICE_SCALE}×${VIEWPORT.height * DEVICE_SCALE}`,
      lensPrimary: LENS,
      files: captured,
      xPostingTip:
        "Attach up to 4 on main tweet: 02-matrix + 03-play-rail + 04-session-stats + 01-full-desk (or 05-matrix-vex). PNG is lossless — X will recompress; start from 2× scale.",
    };
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`\nDone — ${captured.length} PNGs in ${OUT}/`);
  } finally {
    await browser.close();
    await auth.cleanup?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

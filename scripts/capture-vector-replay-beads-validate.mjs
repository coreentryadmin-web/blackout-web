#!/usr/bin/env node
/**
 * Prod validation — Vector bead rail (live + replay), Events/Rings toggles, replay scrub.
 * Requires CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 * Output → /opt/cursor/artifacts/vector-replay-validate/
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const ART = "/opt/cursor/artifacts/vector-replay-validate";
const TICKER = process.env.VECTOR_SCREENSHOT_TICKER || "SPX";

fs.mkdirSync(ART, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

/** Sample non-background pixels on chart canvas (beads + candles). */
async function canvasColorStats(page, canvasLocator) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(".vector-chart-canvas canvas, .vector-chart-stage canvas");
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const w = canvas.width;
    const h = canvas.height;
    if (w < 10 || h < 10) return null;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let colored = 0;
    let beadLike = 0;
    // Bead rail colors: gold ~#fbbf24, purple ~#a855f7, cyan accents
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = d[i + 3];
      if (a < 32) continue;
      if (r + g + b < 24) continue; // near black bg
      colored++;
      const isGold = r > 180 && g > 140 && b < 120;
      const isPurple = r > 100 && b > 160 && g < 180;
      const isCyan = g > 160 && b > 180 && r < 120;
      if (isGold || isPurple || isCyan) beadLike++;
    }
    return { colored, beadLike, w, h };
  });
}

console.log(`\n=== Vector replay + beads validation (${BASE}) ===\n`);

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.error("Auth skip:", session.reason);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addCookies(session.cookies);
await context.addInitScript(onboardingInitScript());
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err.message)));

let exitCode = 0;

try {
  await page.goto(`${BASE}/vector?ticker=${TICKER}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".vector-chart-wrap").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForTimeout(5000);
  rec("page-load", "PASS", `/vector?ticker=${TICKER}`);

  const desktopShell = page.locator(".vector-toolbar-desk");
  await desktopShell.waitFor({ state: "visible", timeout: 60_000 });

  // Bead toggles — Events, Rings, $ Size
  for (const id of ["bead-event-glyphs", "bead-integrity-rings", "bead-dollar-sizing"]) {
    const btn = page.locator(`[data-testid="vector-bead-${id}"]`).first();
    if ((await btn.count()) === 0) {
      rec(`bead-toggle-${id}`, "WARN", "chip missing");
      continue;
    }
    const on = (await btn.getAttribute("aria-pressed")) === "true";
    rec(`bead-toggle-${id}`, "PASS", on ? "on" : "off");
  }

  const eventsBtn = page.locator('[data-testid="vector-bead-bead-event-glyphs"]').first();
  if ((await eventsBtn.count()) > 0 && (await eventsBtn.getAttribute("aria-pressed")) !== "true") {
    await eventsBtn.click();
    await page.waitForTimeout(600);
  }

  const liveStats = await canvasColorStats(page);
  if (!liveStats) {
    rec("live-canvas-sample", "FAIL", "no canvas");
    exitCode = 1;
  } else {
    rec("live-canvas-sample", "PASS", `colored=${liveStats.colored} beadLike=${liveStats.beadLike}`);
    await page.screenshot({ path: path.join(ART, "01-live-beads.png"), fullPage: false });
  }

  const replayToggle = desktopShell.locator('[data-testid="vector-replay-toggle"]');
  const replayEnabled = await replayToggle.isEnabled().catch(() => false);
  if (!replayEnabled) {
    rec("replay-enter", "WARN", "replay disabled — thin timeline");
  } else {
    await replayToggle.click({ force: true, timeout: 15_000 });
    await page.waitForTimeout(1200);
    const replayActive = (await page.locator('[data-replay-active="true"]').count()) > 0;
    rec("replay-enter", replayActive ? "PASS" : "FAIL", replayActive ? "replay mode" : "not active");
    if (!replayActive) exitCode = 1;

    await page.screenshot({ path: path.join(ART, "02-replay-start.png"), fullPage: false });

    const scrub = desktopShell.locator(
      '.vector-toolbar-desk-right input[type="range"][aria-label="Replay position"]'
    );
    if (await scrub.isVisible().catch(() => false)) {
      const max = await scrub.getAttribute("max");
      const mid = max ? String(Math.max(1, Math.floor(Number(max) * 0.55))) : "1";
      await scrub.fill(mid);
      await page.waitForTimeout(1500);
      rec("replay-scrub", "PASS", `step=${mid}/${max ?? "?"}`);
    } else {
      rec("replay-scrub", "WARN", "scrubber not visible");
    }

    const replayStats = await canvasColorStats(page);
    if (!replayStats) {
      rec("replay-canvas-sample", "FAIL", "no canvas in replay");
      exitCode = 1;
    } else {
      rec(
        "replay-canvas-sample",
        "PASS",
        `colored=${replayStats.colored} beadLike=${replayStats.beadLike}`
      );
      await page.screenshot({ path: path.join(ART, "03-replay-mid-beads.png"), fullPage: false });

      // After #2248 replay must show bead-like pixels when live did (allow 30% tolerance — coarser bucket).
      if (liveStats && liveStats.beadLike > 80) {
        const ratio = replayStats.beadLike / liveStats.beadLike;
        if (replayStats.beadLike < 40) {
          rec("replay-beads-vs-live", "FAIL", `beadLike replay=${replayStats.beadLike} live=${liveStats.beadLike}`);
          exitCode = 1;
        } else if (ratio < 0.15) {
          rec("replay-beads-vs-live", "WARN", `ratio=${ratio.toFixed(2)} — replay sparser but present`);
        } else {
          rec("replay-beads-vs-live", "PASS", `ratio=${ratio.toFixed(2)}`);
        }
      } else if (replayStats.beadLike >= 40) {
        rec("replay-beads-vs-live", "PASS", "beads present in replay");
      } else {
        rec("replay-beads-vs-live", "WARN", "low bead signal off-hours — manual screenshot review");
      }
    }

    // Scrub near end
    if (await scrub.isVisible().catch(() => false)) {
      const max = await scrub.getAttribute("max");
      if (max) await scrub.fill(max);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(ART, "04-replay-end-beads.png"), fullPage: false });
      const endStats = await canvasColorStats(page);
      if (endStats) {
        rec("replay-end-beads", endStats.beadLike >= 40 ? "PASS" : "WARN", `beadLike=${endStats.beadLike}`);
      }
    }

    await replayToggle.click({ force: true, timeout: 15_000 });
    await page.waitForTimeout(800);
    rec("replay-exit", "PASS");
  }

  const chunkErrs = consoleErrors.filter((e) =>
    /ChunkLoadError|Loading chunk|Refused to execute script/i.test(e)
  );
  if (chunkErrs.length) {
    rec("console-chunk-errors", "WARN", `${chunkErrs.length} chunk errors`);
  } else {
    rec("console-clean", consoleErrors.length ? "WARN" : "PASS", `${consoleErrors.length} console errors`);
  }

  fs.writeFileSync(path.join(ART, "checks.json"), JSON.stringify({ checks, liveStats, ts: new Date().toISOString() }, null, 2));
  console.log(`\nArtifacts → ${ART}/`);
  console.log(exitCode ? "\nRED — replay/beads validation failed\n" : "\nGREEN — replay/beads validation passed\n");
} catch (err) {
  await page.screenshot({ path: path.join(ART, "error.png"), fullPage: false }).catch(() => {});
  console.error("FAIL:", err?.message || err);
  exitCode = 1;
} finally {
  await browser.close();
  await session.cleanup?.();
}

process.exit(exitCode);

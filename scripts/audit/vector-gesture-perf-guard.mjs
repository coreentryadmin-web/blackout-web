#!/usr/bin/env node
/**
 * Vector gesture-perf regression guard — the committed form of the one-off CDP CPU profile that
 * found the wall-rail perf bug (2026-08-27, PR #2939, `WallRailPrimitive._derivedCache`).
 *
 * WHY THIS EXISTS: that bug was found by hand — a scripted wheel-zoom + drag burst profiled with
 * `Profiler.start`/`Profiler.stop` through a CDP session — because nothing committed would have
 * caught it regressing back in. Cursor's own review of #2939 suggested exactly this: turn the
 * measurement into a gate. `lib/gesture-perf-eval.mjs` holds the pure aggregation/verdict logic
 * (unit-tested there); this script supplies the live CDP capture against real prod.
 *
 * Measured signature of the original bug: one function (`WallRailPrimitive`'s renderer, re-deriving
 * data on every canvas repaint instead of once per poll) consumed 31% of all samples during the
 * gesture; after the fix, 7%.
 *
 * `--max-share` defaults to 35, calibrated from a LIVE baseline run against this exact gesture on
 * production (2026-08-27), not guessed: the hottest function on every run is consistently inside
 * the lightweight-charts vendor bundle itself (chunk `2364.*.js` — its own canvas draw/series-render
 * internals, the same top-3 functions on both SPX and SPY), not app code, and its share is
 * legitimate per-frame rendering cost rather than a regression. Measured range across 2 runs:
 * 15.8%-21.2% for that single hottest vendor function. A cap at 15 (the original guess, before this
 * was measured) fails on that baseline noise alone — a gate that always fails trains its reader to
 * ignore it. 35 leaves ~14-19pt of headroom over the observed vendor-chunk noise band while still
 * catching a doubling-class regression (the original bug's own app-code function hit 31%). This is
 * a first calibration from 2 runs, not a backtested distribution — revisit if it starts flapping.
 *
 * Read-only. One temp Clerk user, released in a finally. Never prints secrets.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/vector-gesture-perf-guard.mjs [--base=https://blackouttrades.com] [--ticker=SPX] [--max-share=15] [--json]
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { evaluateGesturePerfGuard } from "./lib/gesture-perf-eval.mjs";

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};

const BASE = flag("base", "https://blackouttrades.com");
const TICKER = flag("ticker", "SPX");
const MAX_SHARE = Number(flag("max-share", 35));
const OUT = flag("out", "/tmp/vector-gesture-perf-guard.cpuprofile");
const asJson = !!flag("json");
const TARGET = `${BASE}/vector?ticker=${TICKER}`;

/**
 * The scripted gesture: a wheel-zoom burst (20 alternating zoom-in/out ticks) followed by 4
 * click-drag passes across the chart canvas. This is the exact gesture the original CDP profile
 * used to catch the wall-rail regression — a guard that exercises a DIFFERENT gesture than the bug
 * it's named after would not necessarily reproduce the same hot path.
 */
async function runGesture(ctx, page) {
  const client = await ctx.newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 100 }); // microseconds

  const canvas = page.locator(".vector-chart-canvas, canvas").first();
  const box = await canvas.boundingBox().catch(() => null);
  if (!box) return { error: "no chart canvas found — page likely did not load the chart" };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await client.send("Profiler.start");
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    await page.waitForTimeout(40);
  }
  for (let pass = 0; pass < 4; pass++) {
    await page.mouse.move(cx + 150, cy);
    await page.mouse.down();
    for (let step = 0; step <= 10; step++) {
      await page.mouse.move(cx + 150 - step * 30, cy, { steps: 2 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
  const { profile } = await client.send("Profiler.stop");
  return { profile };
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP — ${session.reason}`);
    process.exit(0);
  }

  let browser;
  try {
    const tunneled = await createTunneledContext({
      url: TARGET,
      viewport: "1600x1000",
      desktop: true,
      cookie: session.cookieHeader,
      requestTimeoutMs: 45000,
    });
    browser = tunneled.browser;
    const { ctx } = tunneled;
    const page = await ctx.newPage();
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
      console.warn(`[nav] ${e.message}`);
    });
    // Let the chart mount, poll once, and settle before profiling — profiling the initial mount
    // would measure a different (known-heavy) code path than a steady-state gesture.
    await page.waitForTimeout(13000);

    const { profile, error } = await runGesture(ctx, page);
    if (error) {
      console.log(`HARNESS — ${error}`);
      process.exit(1);
    }

    mkdirSync(require("node:path").dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(profile));

    const result = evaluateGesturePerfGuard(profile, { maxSharePct: MAX_SHARE });

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`profile saved to ${OUT} (nodes: ${profile.nodes.length}, samples: ${result.totalSamples})`);
      console.log("=== TOP FUNCTION SHARES ===");
      for (const s of result.shares) {
        console.log(`${s.sharePct.toFixed(1)}%\t${s.count}\t${s.key}`);
      }
      console.log(result.pass ? `PASS — hottest ${result.hottest?.sharePct.toFixed(1) ?? 0}% (cap ${MAX_SHARE}%)` : `FAIL — ${result.reason}`);
    }

    process.exit(result.pass ? 0 : 1);
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});

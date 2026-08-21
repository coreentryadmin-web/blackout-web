/**
 * Vector BEAD PIXEL audit — measure the bead rail off the rendered canvas, not off the model.
 *
 * WHY THIS EXISTS. The member report was visual and specific: "dont you think the beads are too
 * small in size .. and all the beads are same contrast", and later, against a competitor
 * screenshot, "from their model we can clearly see the levels or beads during that point of time
 * was strong and now it is weak .. we miss doing this".
 *
 * Every check we had was on the MODEL side — unit tests over `beadRadiusForPctShare` and
 * `fillAlpha`, which prove the functions return a spread of values for a spread of inputs. None of
 * them prove the member SEES a spread, because between the function and the eye sit the radius
 * budget (clamped to bar spacing), the alpha floor, the row hysteresis, and the canvas itself. A
 * chart whose beads all render at the readable-minimum half-pixel passes every model test while
 * looking exactly like the screenshot that started this. That gap is how #2310 shipped: a correct
 * function, validated on SPX only, produced invisible dots on NVDA.
 *
 * So this measures PIXELS. It loads the real desk at a wide viewport through the CONNECT tunnel,
 * finds the bead canvas, and clusters the drawn bead pixels into blobs, reporting:
 *   - how many beads actually rendered (a rail that drew nothing is the loudest possible failure,
 *     and is invisible to any model-side test)
 *   - the RADIUS distribution and the max/min ratio — the "are they all the same size" question
 *   - the ALPHA/luminance distribution and its spread — the "are they all the same contrast"
 *     question
 *   - the same, split by side (call vs put), since the two are drawn by independent code paths and
 *     a regression in one reads as "half the chart is fine"
 *
 * WHAT IT CANNOT ASSERT — state it, do not imply otherwise:
 *   - That the sizes are CORRECT, i.e. that the big bead is the strong wall. Radius here is a
 *     pixel measurement; whether it maps to the right strike is `gex-depth-validate.mjs`'s job.
 *   - Anything off-hours about DYNAMISM. With the tape frozen at the close the rail is a static
 *     recorded session; a spread measured then is real, but a LACK of late-session beads is not a
 *     fault.
 *   - SSE freshness (the tunnel is one-shot request/response — see proxy-tunnel-context.cjs).
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a `finally` (FAPI is rate-limited,
 * so the run authenticates exactly once). Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-bead-pixel-audit.cjs \
 *     [--tickers=SPX,NVDA] [--viewport=1920x1080] [--out=DIR] [--json]
 *
 * Exits non-zero when a ticker renders no beads at all, or when the rendered beads are degenerate
 * (one size, one contrast) — the two states the member actually reported.
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
const {
  clusterBeadPixels,
  summarizeBeads,
  verdictForTicker,
} = require("./lib/bead-pixel-eval.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
/** SPX (wide strike spacing) AND a dense single name — the pair that caught #2310's overcorrection.
 *  Validating on an index alone is precisely the mistake that shipped invisible NVDA beads. */
const TICKERS = arg("tickers", "SPX,NVDA")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);
const VIEWPORT = arg("viewport", "1920x1080");
const OUT = arg("out", process.env.SHOT_OUT || ".");
const AS_JSON = argv.includes("--json");

/** Chart settle budget. The authenticated Vector SSR is ~5MB through the tunnel and the bead rail
 *  only paints after the wall-history fetch resolves, so a short wait measures an empty canvas and
 *  reports it as a product fault. */
const SETTLE_MS = 16_000;

/**
 * ZOOM IS PART OF THE MEASUREMENT, not a detail (2026-08-19).
 *
 * The rail records a bead every 5 seconds. That is the intended cadence — so across a full RTH
 * session a row holds thousands of beads and CORRECTLY closes into a continuous ribbon. Judging
 * bead size or contrast at session width therefore measures nothing about the beads; it measures
 * how many of them fit on the axis. An earlier run of this harness did exactly that and read the
 * ribbons as a rendering defect.
 *
 * A member resolves individual beads by zooming, so the audit does too: it captures at each of the
 * chart's own zoom presets and reports them separately. `structure` (~75 minutes) and `live` (~48
 * bars) are the windows where bead geometry is legible; `session` is kept only as context, and a
 * high merged-run count THERE is expected rather than a fault.
 */
const ZOOMS = [
  { id: "session", testid: "vector-intraday-zoom-session", resolves: false },
  { id: "structure", testid: "vector-intraday-zoom-structure", resolves: true },
  { id: "live", testid: "vector-intraday-zoom-live", resolves: true },
];

async function captureTicker(ctx, ticker) {
  const page = await ctx.newPage();
  const shots = [];
  try {
    await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForTimeout(SETTLE_MS);

    for (const zoom of ZOOMS) {
      // Resolve to the element a MEMBER can hit: the desk renders each toolbar control twice and
      // querySelector returns the 0x0 copy first (see vector-ui-walkthrough.cjs for the full trap).
      const btn = page.locator(`[data-testid=${zoom.testid}]`).filter({ visible: true }).last();
      if (await btn.count()) {
        await btn.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(4000);
      } else if (zoom.id !== "session") {
        shots.push({ zoom: zoom.id, error: "zoom preset control not rendered" });
        continue;
      }

      // The bead rail is drawn onto the chart's canvas stack. Take the LARGEST canvas: the chart
      // renders several (price, volume pane, rail overlay) and a small one would crop the rail.
      const box = await page.evaluate(() => {
        let best = null;
        for (const c of document.querySelectorAll("canvas")) {
          const r = c.getBoundingClientRect();
          if (r.width < 200 || r.height < 120) continue;
          if (!best || r.width * r.height > best.width * best.height) {
            best = { x: r.x, y: r.y, width: r.width, height: r.height };
          }
        }
        return best;
      });
      if (!box) {
        shots.push({ zoom: zoom.id, error: "no chart canvas found" });
        continue;
      }
      const shot = path.join(OUT, `beads-${ticker}-${zoom.id}.png`);
      await page.screenshot({
        path: shot,
        clip: {
          x: Math.max(0, Math.floor(box.x)),
          y: Math.max(0, Math.floor(box.y)),
          width: Math.floor(box.width),
          height: Math.floor(box.height),
        },
      });
      shots.push({ zoom: zoom.id, shot, resolves: zoom.resolves });
    }
    return { ticker, shots };
  } finally {
    await page.close().catch(() => {});
  }
}

async function analyze(shotPath) {
  // sharp is already a dependency (the Largo card measurement uses it). Raw RGBA so the clustering
  // works on real channel values rather than a re-encoded approximation.
  const sharp = require("sharp");
  const { data, info } = await sharp(shotPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return clusterBeadPixels(data, info.width, info.height, info.channels);
}

async function run(session) {
  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/vector`,
    cookie: session.cookieHeader,
    viewport: VIEWPORT,
    desktop: true,
    // The authenticated desk document alone is multi-MB; the tunnel's default per-request timeout
    // aborts it and the failure is indistinguishable from an outage.
    requestTimeoutMs: 60_000,
  });
  const results = [];
  try {
    for (const ticker of TICKERS) {
      const cap = await captureTicker(ctx, ticker);
      for (const sh of cap.shots) {
        if (sh.error) {
          results.push({ ticker, zoom: sh.zoom, verdict: "RED", reason: sh.error, notes: [] });
          continue;
        }
        const clusters = await analyze(sh.shot);
        const summary = summarizeBeads(clusters);
        summary.mergedRuns = (clusters.mergedRuns || []).length;
        // At session width a merged run is the 5s cadence doing its job, so only the zooms that can
        // resolve beads get a pass/fail on geometry.
        const v = sh.resolves
          ? verdictForTicker(summary)
          : { verdict: "INFO", notes: ["session width — beads merge by design at this zoom"] };
        results.push({ ticker, zoom: sh.zoom, shot: sh.shot, ...summary, ...v });
      }
    }
  } finally {
    await browser.close();
  }
  return { results, counts };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Imported lazily: this file is CJS and the session helper is ESM.
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  let out;
  try {
    out = await run(session);
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  const { results, counts } = out;
  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, viewport: VIEWPORT, counts, results }, null, 2));
  } else {
    console.log(`BEAD PIXEL AUDIT — ${BASE} @ ${VIEWPORT}`);
    console.log(`tunnel: ${counts.ok} ok, ${counts.fail} fail`);
    for (const r of results) {
      if (r.verdict === "RED" && r.reason) {
        console.log(`  ${r.ticker.padEnd(6)} ${String(r.zoom).padEnd(10)} RED   ${r.reason}`);
        continue;
      }
      console.log(
        `  ${r.ticker.padEnd(6)} ${String(r.zoom).padEnd(10)} ${r.verdict.padEnd(5)} ` +
          `beads=${String(r.count).padStart(4)} (call ${r.callCount}/put ${r.putCount}) ` +
          `merged=${String(r.mergedRuns).padStart(3)}  ` +
          `radius p10/p50/p90=${r.radiusP10}/${r.radiusP50}/${r.radiusP90}px ` +
          `ratio=${r.radiusRatio}x lum=${r.lumSpread}  ${r.notes.join("; ")}`
      );
    }
  }
  process.exit(results.some((r) => r.verdict === "RED") ? 1 : 0);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

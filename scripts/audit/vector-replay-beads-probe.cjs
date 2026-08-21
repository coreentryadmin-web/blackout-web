/**
 * Vector REPLAY bead probe — does the wall rail actually paint beads while scrubbing?
 *
 * WHY A PIXEL PROBE. The beads are drawn onto the lightweight-charts CANVAS, not into the DOM, so
 * there is no element to count and `expect(locator).toBeVisible()` can never answer the question a
 * member is actually asking ("I see candles and no beads"). The only honest observable is the
 * painted image, so this reads the screenshot back and counts pixels near the two bead hues the
 * chart uses (VectorChart.tsx: CALL_WALL_COLOR #ffd60a, PUT_WALL_COLOR #d97bff).
 *
 * WHY THE COUNT IS A CURVE, NOT A THRESHOLD. #ffd60a is also the Fib-golden level colour and an
 * indicator colour, so a nonzero yellow count alone proves nothing. What the replay-timeline bug
 * (#2370) produced was a SHAPE: the scrubber spanned ~3 sessions while the rail only renders the
 * current one, so early cursor positions mapped to timestamps the rail had no data for and painted
 * ZERO beads, with beads appearing only once the cursor reached the live session. So this samples
 * several positions across the scrubber and reports the profile. A run where the early samples are
 * empty and the late ones are populated is the bug; a run where beads are present across the range
 * is the fixed behaviour.
 *
 * WHAT IT CANNOT ASSERT — say so plainly:
 *   - That the beads are CORRECT. It checks that they are painted, not that the walls are right.
 *   - Anything requiring SSE. The tunnel is request/response; the desk falls back to SWR polling.
 *   - Off-hours, the "session" is the last completed one. That is correct behaviour, not a fault.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 *
 * Run from the REPO ROOT:
 *   node scripts/audit/vector-replay-beads-probe.cjs [--ticker=SPX] [--out=DIR] [--json]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPX");
const OUT = arg("out", process.env.SHOT_OUT || ".");
const LABEL = arg("label", "run");
const AS_JSON = argv.includes("--json");

/** Bead hues, from VectorChart.tsx. Matched with tolerance because the chart composites them at
 *  varying alpha over a near-black ground, so an exact hex match would find almost nothing. */
const BEAD_HUES = [
  { name: "call", r: 0xff, g: 0xd6, b: 0x0a },
  { name: "put", r: 0xd9, g: 0x7b, b: 0xff },
];
const TOL = 46;

/**
 * Count bead-coloured pixels by reading the canvas back IN THE PAGE via getImageData.
 *
 * Deliberately not decoding a PNG in Node: that needs an image library this sandbox does not have,
 * and it would also measure the screenshot's re-encoding rather than what the chart actually drew.
 * The canvas is same-origin and 2D, so it is not tainted and getImageData is allowed.
 *
 * Sums across EVERY canvas the desk stacks (lightweight-charts uses several layered canvases, and
 * the wall rail is not guaranteed to be the first one) — counting only `canvas:first` would report
 * zero beads on a chart that is painting them one layer up.
 */
async function countBeadPixelsInPage(page, hues, tol) {
  return page.evaluate(
    ({ hues, tol }) => {
      const out = { call: 0, put: 0, canvases: 0, pixels: 0 };
      for (const c of Array.from(document.querySelectorAll("canvas"))) {
        if (!c.width || !c.height) continue;
        let img;
        try {
          img = c.getContext("2d")?.getImageData(0, 0, c.width, c.height);
        } catch {
          continue; // tainted or webgl — skip rather than pretend
        }
        if (!img) continue;
        out.canvases += 1;
        out.pixels += c.width * c.height;
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) continue;
          for (const h of hues) {
            if (
              Math.abs(d[i] - h.r) <= tol &&
              Math.abs(d[i + 1] - h.g) <= tol &&
              Math.abs(d[i + 2] - h.b) <= tol
            ) {
              out[h.name] += 1;
              break;
            }
          }
        }
      }
      out.total = out.call + out.put;
      return out;
    },
    { hues, tol }
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const url = `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`;

  // Imported lazily: this file is CJS and the session helper is ESM (same pattern as
  // vector-ui-walkthrough.cjs). ONE temp member for the whole run — FAPI is rate-limited.
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }
  const cookie = session.cookieHeader;
  const release = () => session.cleanup();

  const report = { base: BASE, ticker: TICKER, label: LABEL, samples: [], notes: [] };

  const { browser, ctx, counts } = await createTunneledContext({
    url,
    cookie,
    viewport: "1440x900",
    desktop: true,
  });

  try {
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(11_000);

    // The desk renders BOTH the desktop and the iOS-shell control trees, so this testid matches
    // twice and a bare locator is a strict-mode violation. Scope to the VISIBLE one — clicking the
    // hidden shell's button would report "replay had no effect" on a control that works.
    const toggle = page.locator("[data-testid=vector-replay-toggle]:visible").first();
    if (!(await toggle.count())) throw new Error("replay toggle not found — page may not have rendered the desk");
    if (await toggle.isDisabled()) {
      report.notes.push("replay toggle DISABLED — no replayable session available at this time");
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // CONTROL SAMPLE, taken in LIVE mode BEFORE entering replay.
    // Without it a run of zeros is uninterpretable: "replay paints no beads" and "this probe
    // cannot see beads" produce identical output. If live is also zero, the run proves nothing
    // about replay and says so instead of reporting a defect.
    const liveBeads = await countBeadPixelsInPage(page, BEAD_HUES, TOL);
    await page.screenshot({ path: path.join(OUT, `live-${LABEL}-${TICKER}.png`) }).catch(() => {});
    report.liveControl = liveBeads;

    await page.keyboard.press("Escape").catch(() => {});
    await toggle.click();
    await page.waitForTimeout(5000);

    const scrub = page.locator('input[type=range][aria-label="Replay position"]:visible').first();
    if (!(await scrub.count())) throw new Error("replay scrubber not found after entering replay");

    const maxIndex = Number(await scrub.getAttribute("max"));
    report.stepCount = maxIndex + 1;

    // Sample across the whole scrubber. The bug lived at the LOW end — those indices mapped into
    // earlier sessions the rail never renders.
    const fractions = [0.0, 0.05, 0.15, 0.35, 0.6, 0.85, 1.0];
    for (const f of fractions) {
      const idx = Math.round(maxIndex * f);
      await scrub.fill(String(idx));
      await scrub.dispatchEvent("change");
      await page.waitForTimeout(2200);

      const clock = (await page.locator(".vector-replay-controls span.font-mono:visible").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const beads = await countBeadPixelsInPage(page, BEAD_HUES, TOL);

      const file = path.join(OUT, `replay-${LABEL}-${TICKER}-${String(idx).padStart(4, "0")}.png`);
      await page.screenshot({ path: file }).catch(() => {});
      report.samples.push({ frac: f, index: idx, clock, beads, shot: file });
    }

    report.consoleErrors = consoleErrors.slice(0, 5);
    report.routed = { ok: counts?.ok, fail: counts?.fail };
  } finally {
    await browser.close().catch(() => {});
    if (release) await release().catch(() => {});
    console.error("temp Clerk user deleted");
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nREPLAY BEAD PROFILE — ${TICKER} @ ${BASE}  (${report.label})`);
    console.log(`steps: ${report.stepCount}   routed: ${report.routed?.ok} ok / ${report.routed?.fail} fail`);
    console.log("  idx      clock                 call px    put px    total");
    for (const s of report.samples) {
      if (s.error) { console.log(`  ${String(s.index).padStart(5)}  ${s.error}`); continue; }
      console.log(
        `  ${String(s.index).padStart(5)}  ${(s.clock || "").padEnd(20).slice(0, 20)}  ${String(s.beads.call).padStart(7)}  ${String(s.beads.put).padStart(8)}  ${String(s.beads.total).padStart(7)}`
      );
    }
    const lc = report.liveControl;
    console.log(`\n  LIVE control (not replay): call=${lc?.call} put=${lc?.put} total=${lc?.total} across ${lc?.canvases} canvases`);
    const empty = report.samples.filter((s) => s.beads && s.beads.total === 0).length;
    console.log(`  ${empty}/${report.samples.length} sampled REPLAY positions painted ZERO bead pixels`);
    if (!lc || lc.total === 0) {
      console.log("  INCONCLUSIVE: the live control is also zero, so this run cannot distinguish");
      console.log("               'replay paints no beads' from 'the probe cannot see beads'.");
    }
    if (report.consoleErrors?.length) console.log(`  console errors: ${report.consoleErrors.length}`);
  }
}

main().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});

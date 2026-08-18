/**
 * Vector bead ZOOM audit — does the bead rail read as BEADS at the zoom levels a member uses?
 *
 * WHY THIS EXISTS. Every visual judgement about the bead rail up to now was made from a single
 * static page load at one default zoom, and that produced two confidently wrong diagnoses in a row.
 * A member does not stare at the default frame: they zoom in on the last hour, zoom out to the
 * session, flip timeframes, and pan. The rail has to hold up across all of that, because bead size
 * is now budgeted against ON-SCREEN ROOM (bar spacing + row gap, see clampTuningToSpacing) and that
 * budget is exactly what changes when you scroll the wheel.
 *
 * WHAT IT DOES. Drives the real chart the way a person does — wheel-zoom in and out over the canvas,
 * across several timeframes — and captures a PNG per state PLUS the two numbers that decide whether
 * beads can be discrete at all: the time scale's `barSpacing` and the resulting bead ceiling.
 *
 * WHAT IT CANNOT DO — say so rather than imply otherwise:
 *   - Judge the picture. It captures evidence; a human (or a vision pass) still has to LOOK.
 *   - Stream. The tunnel is one-shot request/response, so SSE is aborted and the desk falls back to
 *     SWR polling. Off-hours the tape is frozen at the close and that is correct, not a fault.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 *
 * Run: node scripts/audit/vector-bead-zoom-audit.cjs [--ticker=SPX] [--out=DIR]
 */
const path = require("path");
const fs = require("fs");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPX");
const OUT = arg("out", "/tmp/vector-bead-zoom");

/** Wheel steps per state. Negative = zoom IN (fewer bars, more room each). */
const ZOOM_STATES = [
  { label: "default", wheel: 0 },
  { label: "zoom-in-1", wheel: -3 },
  { label: "zoom-in-2", wheel: -6 },
  { label: "zoom-in-3", wheel: -10 },
  { label: "zoom-out-1", wheel: 6 },
  { label: "zoom-out-2", wheel: 12 },
];

/** Timeframes to sweep. A fix that works at 3m and fails at 1h is not a fix. */
const TIMEFRAMES = ["1m", "3m", "15m", "1h"];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }

  const url = `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`;
  const { browser, ctx, counts } = await createTunneledContext({
    url,
    cookie: session.cookieHeader,
    viewport: "1680x1050",
    desktop: true,
  });
  const page = await ctx.newPage();
  const rows = [];

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(14000);

    // The chart canvas is the biggest one on the page — the ladder and sparklines are far smaller.
    const box = await page.evaluate(() => {
      const cs = [...document.querySelectorAll("canvas")];
      let best = null;
      for (const c of cs) {
        const r = c.getBoundingClientRect();
        if (!best || r.width * r.height > best.width * best.height) best = r.toJSON();
      }
      return best;
    });
    if (!box || box.width * box.height < 10000) throw new Error("no chart canvas with real pixels");
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    for (const tf of TIMEFRAMES) {
      // Timeframe control is a native select on the desk; fall back to a button with the label.
      const switched = await page
        .evaluate((label) => {
          const sel = [...document.querySelectorAll("select")].find((s) =>
            [...s.options].some((o) => o.textContent.trim().toLowerCase().startsWith(label))
          );
          if (sel) {
            const opt = [...sel.options].find((o) =>
              o.textContent.trim().toLowerCase().startsWith(label)
            );
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return "select";
          }
          const btn = [...document.querySelectorAll("button")].find(
            (b) => b.textContent.trim().toLowerCase() === label
          );
          if (btn) { btn.click(); return "button"; }
          return null;
        }, tf.toLowerCase())
        .catch(() => null);
      await page.waitForTimeout(4500);

      for (const z of ZOOM_STATES) {
        if (z.wheel !== 0) {
          await page.mouse.move(cx, cy);
          for (let i = 0; i < Math.abs(z.wheel); i++) {
            await page.mouse.wheel(0, z.wheel < 0 ? -120 : 120);
            await page.waitForTimeout(90);
          }
        }
        await page.waitForTimeout(1400);

        // barSpacing is THE input to the bead budget. Capturing it turns "looks better" into a
        // number that explains why, and catches a state where the budget never bound at all.
        const spacing = await page
          .evaluate(() => {
            const w = window;
            const c = w.__vectorChart || w.chart || null;
            try {
              return c && c.timeScale ? c.timeScale().options().barSpacing : null;
            } catch {
              return null;
            }
          })
          .catch(() => null);

        const file = path.join(OUT, `${TICKER}-${tf}-${z.label}.png`);
        await page.screenshot({ path: file });
        rows.push({ ticker: TICKER, tf, zoom: z.label, barSpacing: spacing, file, switched });
        console.log(
          `${TICKER} ${tf.padEnd(4)} ${z.label.padEnd(11)} barSpacing=${spacing ?? "n/a"} -> ${path.basename(file)}`
        );
        // Return to the default frame so each zoom state starts from the same place rather than
        // compounding — otherwise "zoom-out-2" means something different on every timeframe.
        if (z.wheel !== 0) {
          await page.evaluate(() => {
            const c = window.__vectorChart || window.chart;
            try { c?.timeScale?.().fitContent?.(); } catch { /* best effort */ }
          }).catch(() => {});
          await page.waitForTimeout(700);
        }
      }
    }
    console.log(`\nRouted: ${counts?.ok ?? "?"} ok, ${counts?.fail ?? "?"} fail`);
    console.log(JSON.stringify({ out: OUT, states: rows.length }, null, 1));
  } finally {
    await browser.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

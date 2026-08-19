/**
 * Vector RAIL VISIBILITY shot — capture the chart WITH its price axis.
 *
 * WHY THIS EXISTS, and why it is not the bead pixel audit. `vector-bead-pixel-audit.cjs` clips its
 * screenshot to the chart CANVAS, which is correct for measuring bead geometry and useless for the
 * question this answers: it crops away the price axis, so a rail that is missing because the price
 * scale never widened to cover it looks identical to a rail that was never drawn.
 *
 * Measured 2026-08-19: SPX painted ~12 bead rows spanning well above and below the candle band,
 * while NVDA painted exactly ONE — yet `vector-row-render-probe.mjs` shows the REAL client pipeline
 * (bucket -> lifecycle -> pickActiveStrikes) yielding 7-10 rows per side for NVDA off the same
 * payload. Both facts hold, so the rows are being produced and then not SHOWN, and the price axis
 * is the only place that can be read to tell which. Hence: full viewport, axis included.
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-rail-visibility-shot.cjs \
 *     [--tickers=SPX,NVDA] [--zoom=structure] [--viewport=1920x1080] [--out=DIR]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKERS = arg("tickers", "SPX,NVDA").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const ZOOM = arg("zoom", "structure");
const VIEWPORT = arg("viewport", "1920x1080");
const OUT = arg("out", process.env.SHOT_OUT || ".");

/** The authenticated Vector SSR is multi-MB through the tunnel and the rail paints only after the
 *  wall-history fetch resolves — a short wait photographs an empty chart and blames the product. */
const SETTLE_MS = 16_000;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/vector`,
    cookie: session.cookieHeader,
    viewport: VIEWPORT,
    desktop: true,
    requestTimeoutMs: 60_000,
  });

  const out = [];
  try {
    for (const ticker of TICKERS) {
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForTimeout(SETTLE_MS);
        // Resolve to the control a MEMBER can hit: the desk renders each toolbar control twice and
        // querySelector returns the 0x0 copy first.
        const btn = page
          .locator(`[data-testid=vector-intraday-zoom-${ZOOM}]`)
          .filter({ visible: true })
          .last();
        if (await btn.count()) {
          await btn.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(4000);
        }
        const shot = path.join(OUT, `rail-${ticker}-${ZOOM}.png`);
        await page.screenshot({ path: shot });
        out.push({ ticker, shot });
        console.log(`${ticker}: ${shot}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }
  console.error(`tunnel: ${counts.ok} ok, ${counts.fail} fail`);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

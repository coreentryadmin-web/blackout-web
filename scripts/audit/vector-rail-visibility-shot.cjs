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
 *     [--tickers=SPX,NVDA] [--zooms=none,session,structure,live] [--viewport=1920x1080] [--out=DIR]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext, applyCookieToContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKERS = arg("tickers", "SPX,NVDA").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
/** Every zoom preset by default: the rail has to hold at ALL of them, and #2325's defect was
 *  visible only after a preset was pressed. "none" captures the default frame without clicking. */
const ZOOMS = arg("zooms", arg("zoom", "none,session,structure,live"))
  .split(",")
  .map((z) => z.trim())
  .filter(Boolean);
const VIEWPORT = arg("viewport", "1920x1080");
const OUT = arg("out", process.env.SHOT_OUT || ".");
/** Fail the run outright if the tab was served by more than one build (see buildFingerprint). */
const STRICT_BUILD = !argv.includes("--allow-mixed-build");
/** Enter fullscreen (focus mode) before capturing — the chrome there is a separate surface, and a
 *  control missing ONLY in fullscreen is invisible to every normal capture. */
const FULLSCREEN = argv.includes("--fullscreen");

/** The authenticated Vector SSR is multi-MB through the tunnel and the rail paints only after the
 *  wall-history fetch resolves — a short wait photographs an empty chart and blames the product. */
const SETTLE_MS = 16_000;

/**
 * Which BUILD served this page.
 *
 * Next.js chunk filenames are content-hashed, so the set of chunks a page loads identifies the
 * build serving it. Recorded per screenshot because ECS rolls tasks GRADUALLY: for the minutes a
 * rollout takes, some tasks serve the new image and some the old, and which one a given request
 * lands on is chance. A capture taken in that window is evidence of nothing, and looks exactly
 * like evidence of something.
 *
 * That is not hypothetical — it cost this exact investigation a round trip on 2026-08-19. A bundle
 * hash flipped at the edge, the deploy was called done, and the NVDA capture that followed came off
 * an old task and read as "the fix did not work". Stamping the build onto every shot turns that
 * from a wrong conclusion into a reported mismatch.
 */
async function buildFingerprint(page) {
  try {
    // ONLY the shared runtime chunks. Hashing every chunk on the page identifies the PAGE, not the
    // build: /vector?ticker=SPX pulls the SPX desk bundles that NVDA never loads, so a per-page hash
    // reports "mixed build" on a perfectly settled deploy — measured 2026-08-19, three "builds"
    // across four tickers on one rollout. `webpack-*` and `main-app-*` are content-hashed and
    // identical on every page, so they change only when the build does.
    const chunks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src*="/_next/static/chunks/"]'))
        .map((el) => el.getAttribute("src") || "")
        .filter((src) => /\/(webpack|main-app|framework)-[^/]*\.js$/.test(src))
        .sort()
        .join("|")
    );
    if (!chunks) return "unknown";
    let h = 0;
    for (let i = 0; i < chunks.length; i++) h = (Math.imul(31, h) + chunks.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  } catch {
    return "unknown";
  }
}

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
      let page;
      try {
        // Re-mint before EVERY ticker. A Clerk session JWT is short-lived and this run drives the
        // desk for minutes; once it lapses the app bounces the navigation through sign-in, which
        // the tunnel cannot complete, and the page dies as ERR_TOO_MANY_REDIRECTS. That killed the
        // 4th ticker of two consecutive runs. Refreshing costs one FAPI call per ticker, which is
        // well inside the rate limit that makes re-AUTHENTICATING per ticker a bad idea.
        const fresh = await session.refresh?.();
        if (fresh?.cookieHeader) await applyCookieToContext(ctx, fresh.cookieHeader, `${BASE}/vector`);
        page = await ctx.newPage();
        await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForTimeout(SETTLE_MS);

        if (FULLSCREEN) {
          const fs = page.locator("[data-testid=vector-focus-toggle]").filter({ visible: true }).last();
          if (await fs.count()) {
            await fs.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(3500);
          } else {
            console.log(`${ticker}: FULLSCREEN TOGGLE NOT RENDERED`);
          }
        }

        // All presets off ONE page load: the desk authenticates once per run (FAPI is rate-limited)
        // and a fresh load per zoom would also re-pay the multi-MB SSR through the tunnel.
        for (const zoom of ZOOMS) {
          if (zoom !== "none") {
            // Resolve to the control a MEMBER can hit: the desk renders each toolbar control twice
            // and querySelector returns the 0x0 copy first.
            const btn = page
              .locator(`[data-testid=vector-intraday-zoom-${zoom}]`)
              .filter({ visible: true })
              .last();
            if (!(await btn.count())) {
              out.push({ ticker, zoom, error: "zoom preset control not rendered" });
              console.log(`${ticker} ${zoom}: CONTROL NOT FOUND`);
              continue;
            }
            await btn.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(4000);
          }
          const shot = path.join(OUT, `rail-${ticker}-${zoom}${FULLSCREEN ? "-fs" : ""}.png`);
          await page.screenshot({ path: shot });
          const build = await buildFingerprint(page);
          out.push({ ticker, zoom, shot, build });
          console.log(`${ticker} ${zoom}: ${shot}  [build ${build}]`);
        }
      } catch (err) {
        // One ticker must never end the run. A mid-run auth bounce took out the last ticker of an
        // earlier pass and discarded every result already captured, which read as a total failure.
        out.push({ ticker, error: String(err?.message || err).slice(0, 120) });
        console.log(`${ticker}: FAILED — ${String(err?.message || err).slice(0, 120)}`);
      } finally {
        await page?.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }
  console.error(`tunnel: ${counts.ok} ok, ${counts.fail} fail`);

  // One build across every shot, or the set is not comparable — see buildFingerprint.
  const builds = [...new Set(out.map((o) => o.build).filter((b) => b && b !== "unknown"))];
  if (builds.length === 1) {
    console.error(`build: ${builds[0]} (consistent across ${out.length} shots)`);
  } else if (builds.length > 1) {
    console.error(`MIXED BUILD: shots span ${builds.length} builds (${builds.join(", ")}) — a rollout is still in flight, re-run once it settles`);
    if (STRICT_BUILD) process.exit(3);
  }
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

/**
 * Vector #2329/#2330 post-deploy capture.
 *
 * The older `vector-rail-visibility-shot.cjs` drives `--zooms=session,structure,live`, and #2330
 * DELETED those three toolbar presets — so that harness now reports "CONTROL NOT FOUND" three times
 * per ticker, which reads as a product regression when it is just a stale harness. This one captures
 * what actually shipped:
 *   1. the rail at default frame, per ticker, full viewport WITH the price axis (see the sibling
 *      script's header for why the axis has to be in frame)
 *   2. FULLSCREEN — the #2330 fix; the assertion is that the toolbar is reachable, not that it exists
 *      in the DOM, because before the z-index fix it existed and sat *under* the fixed site nav
 *   3. the NODES control, now a <select>
 *   4. COMPARE — NODES present, and the 5m / 8-node compare defaults
 *   5. EXIT COMPARE — the URL must actually leave `?compare=`; `router.push` was a no-op here
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-2330-shots.cjs [--tickers=SPX,NVDA] [--out=DIR]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext, applyCookieToContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKERS = arg("tickers", "SPX,NVDA,TSLA,AAPL").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const OUT = arg("out", ".");
const VIEWPORT = arg("viewport", "1920x1080");
const SETTLE_MS = 16_000;

/** Same rationale as vector-rail-visibility-shot.cjs: ECS rolls gradually, so stamp the build on
 *  every shot. Hash ONLY the shared runtime chunks — page chunks legitimately differ per route, so
 *  hashing all of them reports "mixed build" on a fully settled deploy. */
async function buildFingerprint(page) {
  try {
    const chunks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src*="/_next/static/chunks/"]'))
        .map((el) => el.getAttribute("src") || "")
        .filter((s) => /(webpack|main-app|framework)/.test(s))
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

/** Every toolbar control is rendered twice (desktop row + compact row); querySelector returns the
 *  0x0 copy first, so resolve to the one a member can actually hit. */
const vis = (page, testid) => page.locator(`[data-testid=${testid}]`).filter({ visible: true }).last();

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
  const shot = async (page, name) => {
    const p = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: p });
    const build = await buildFingerprint(page);
    out.push({ name, shot: p, build });
    console.log(`${name}: ${p}  [build ${build}]`);
    return p;
  };

  try {
    for (const ticker of TICKERS) {
      let page;
      try {
        // Re-mint per ticker: the session JWT is short-lived and this run drives the desk for
        // minutes; a lapsed cookie bounces the navigation through sign-in, which the tunnel cannot
        // complete, and the page dies as ERR_TOO_MANY_REDIRECTS.
        const fresh = await session.refresh?.();
        if (fresh?.cookieHeader) await applyCookieToContext(ctx, fresh.cookieHeader, `${BASE}/vector`);
        page = await ctx.newPage();
        await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForTimeout(SETTLE_MS);
        await shot(page, `01-rail-${ticker}`);

        // NODES — read the shipped <select> rather than photographing it and eyeballing the label.
        const sel = vis(page, "vector-nodes-select");
        const nodes = (await sel.count()) ? await sel.inputValue().catch(() => null) : null;
        console.log(`   ${ticker} nodes-select present=${(await sel.count()) > 0} value=${nodes}`);

        if (ticker === TICKERS[0]) {
          // FULLSCREEN. The bug was NOT a missing toolbar — it was a toolbar painted under the
          // fixed site nav (z-100) by a container stuck at z-60. So the check is reachability:
          // does a hit-test at the control's own centre land on the control, or on the nav?
          const ft = vis(page, "vector-focus-toggle");
          if (await ft.count()) {
            await ft.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(3500);
            await shot(page, `02-fullscreen-${ticker}`);
            const reach = await page.evaluate(() => {
              const els = Array.from(document.querySelectorAll("[data-testid]")).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < window.innerHeight;
              });
              const probe = (el) => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !!hit && (el.contains(hit) || hit.contains(el));
              };
              const want = [
                "vector-nodes-select",
                "vector-replay-toggle",
                "vector-indicator-trigger",
                "vector-draw-tools-trigger",
                "vector-ticker-search",
                "vector-focus-toggle",
              ];
              return want.map((id) => {
                const el = els.find((e) => e.getAttribute("data-testid") === id);
                return { id, present: !!el, reachable: el ? probe(el) : false };
              });
            });
            for (const r of reach) console.log(`   FS ${r.id}: present=${r.present} reachable=${r.reachable}`);
            await ft.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(1500);
          } else {
            console.log("   focus toggle not found");
          }

          // COMPARE — the two #2330 defaults (5m timeframe, 8 nodes) and that NODES renders at all,
          // which it did not before.
          const enter = vis(page, "vector-enter-compare");
          if (await enter.count()) {
            await enter.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(9000);
            await shot(page, `03-compare-${ticker}`);
            const cmpSel = vis(page, "vector-nodes-select");
            const cmpNodes = (await cmpSel.count()) ? await cmpSel.inputValue().catch(() => null) : null;
            console.log(`   COMPARE url=${page.url()}`);
            console.log(`   COMPARE nodes-select present=${(await cmpSel.count()) > 0} value=${cmpNodes}`);

            // EXIT COMPARE. The old handler called router.push() to a route the App Router
            // considered current, so nothing moved. Assert on the URL, not on a repaint.
            const before = page.url();
            const exit = vis(page, "vector-compare-exit");
            if (await exit.count()) {
              await exit.click({ timeout: 8000 }).catch(() => {});
              await page.waitForTimeout(9000);
              const after = page.url();
              const left = !/[?&]compare=/.test(after) && after !== before;
              console.log(`   EXIT COMPARE: ${before} -> ${after}  left_compare=${left}`);
              await shot(page, `04-after-exit-compare-${ticker}`);
            } else {
              console.log("   compare exit control not found");
            }
          } else {
            console.log("   enter-compare control not found");
          }
        }
      } catch (err) {
        // One ticker must never end the run — an earlier pass lost every captured result to a
        // mid-run auth bounce on the last ticker.
        out.push({ name: ticker, error: String(err?.message || err).slice(0, 160) });
        console.log(`${ticker}: FAILED — ${String(err?.message || err).slice(0, 160)}`);
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
  const builds = [...new Set(out.map((o) => o.build).filter((b) => b && b !== "unknown"))];
  console.error(builds.length === 1
    ? `build: ${builds[0]} (consistent across ${out.length} shots)`
    : `MIXED BUILD: ${builds.join(", ")} — a rollout is still in flight`);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

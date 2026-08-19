/**
 * Vector RTH MATRIX validation — every 2026-08-19 change, across a wide ticker set, live.
 *
 * WHY A NEW HARNESS. The two existing capture scripts drive `vector-intraday-zoom-{session,
 * structure,live}`, and #2330 DELETED those three toolbar presets. They now report "CONTROL NOT
 * FOUND" three times per ticker, which reads as a product regression when it is a stale harness.
 * This drives what actually shipped — the TIMEFRAME select and the DTE horizon chips — and measures
 * the specific claims made by #2328/#2330/#2333/#2334 rather than photographing a page and hoping.
 *
 * WHAT IT MEASURES, and which change each answers:
 *   BEADS      bead count + radius p10/p50/p90 + max/min ratio + luminance spread, clustered off the
 *              REAL canvas pixels via lib/bead-pixel-eval.cjs. This is the #2334 claim: a rail whose
 *              beads are all one size passes every model-side unit test while looking exactly like
 *              the screenshot that started this. Pixels are the only place the claim is falsifiable.
 *   CANDLES    the candle band's share of the price pane, read off the rendered axis. #2334 promises
 *              a 35% floor; the reported NVDA frame measured 17%.
 *   ROWS       distinct bead ROWS (clusters grouped by y) — the #2334 AUTO-ladder step-up, and the
 *              #2328 claim that NVDA draws ~10 rows rather than 1.
 *   LANE       observed bead bucket seconds, so a 5s shared-universe ticker and a 15s on-demand one
 *              are never compared as if they were the same product. The roster is dynamic and
 *              sticky, so this is OBSERVED per ticker, never assumed from a hard-coded list.
 *   CONSOLE    page errors, which a screenshot silently hides.
 *
 * ON-DEMAND TICKERS ARE NOT A FAILURE. A ticker outside the shared universe records at 15s and may
 * have a short trail early in a session. It is reported as its own lane with its own expectations —
 * calling that RED would be flagging the product for working as designed.
 *
 * Read-only. ONE temp Clerk user for the whole run, deleted in a `finally` (FAPI is rate-limited, so
 * the run authenticates exactly once and re-mints per ticker). Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-rth-matrix-validate.cjs \
 *     [--tickers=A,B,...] [--timeframes=1,3,15] [--dte=0dte,weekly] [--fullscreen=SPX,NVDA]
 *     [--compare=SPX] [--out=DIR] [--json]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext, applyCookieToContext } = require("./lib/proxy-tunnel-context.cjs");
const { clusterBeadPixels, summarizeBeads } = require("./lib/bead-pixel-eval.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

const TICKERS = list(arg("tickers", "SPX,SPY,QQQ,IWM,NVDA,TSLA,AAPL,MSFT,AMZN,META,AMD,GOOGL,NFLX,AVGO,COIN,PLTR,MU,SMCI,ASTS,SOFI")).map((t) => t.toUpperCase());
const TIMEFRAMES = list(arg("timeframes", "3"));
const DTES = list(arg("dte", ""));
const FULLSCREEN = list(arg("fullscreen", "")).map((t) => t.toUpperCase());
const COMPARE = list(arg("compare", "")).map((t) => t.toUpperCase());
const VIEWPORT = arg("viewport", "1920x1080");
const OUT = arg("out", process.env.SHOT_OUT || ".");
const AS_JSON = argv.includes("--json");

/** The authenticated desk is multi-MB through the tunnel and the rail paints only after the
 *  wall-history fetch resolves — a short wait photographs an empty chart and blames the product. */
const SETTLE_MS = 16_000;
const SWITCH_MS = 5_000;

/** #2334's promise. Reported as a measurement either way; only a LARGE shortfall is called out, and
 *  never on a frame with too few bars for the floor to bind. */
const CANDLE_SHARE_TARGET = 0.35;

/** Hash only the SHARED runtime chunks. Page chunks legitimately differ per route, so hashing all
 *  of them reports "mixed build" on a fully settled deploy — that cost a round trip on 2026-08-19. */
async function buildFingerprint(page) {
  try {
    const s = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src*="/_next/static/chunks/"]'))
        .map((el) => el.getAttribute("src") || "")
        .filter((x) => /(webpack|main-app|framework)/.test(x))
        .sort()
        .join("|")
    );
    if (!s) return "unknown";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  } catch {
    return "unknown";
  }
}

/** Every toolbar control renders twice (desktop row + compact row) and querySelector returns the
 *  0x0 copy first, so always resolve to the copy a member can actually hit. */
const vis = (page, testid) => page.locator(`[data-testid=${testid}]`).filter({ visible: true }).last();

/**
 * Price-pane geometry, read off what the chart actually rendered.
 *
 * The axis labels are the only honest source here: the visible range is the product of autoscale,
 * the wall widening and the candle-share cap composed together, and re-deriving it from any one of
 * those inputs would measure the intent rather than the result.
 */
/**
 * Price-pane geometry — REMOVED, deliberately, rather than left disabled.
 *
 * This scraped the price-axis tick labels to derive the visible price range. On a live desk it
 * selected a different numeric column entirely: it returned an identical axis span (309.79) for
 * SPX at ~7700 and NVDA at ~220, which cannot both be right and is in fact neither.
 *
 * It is not needed. The candle-share measurement below comes from canvas pixels in ONE coordinate
 * system and answers the same question without a second, unvalidated source of truth. An earlier
 * revision kept the body behind an early `return null` with this explanation attached; CodeQL
 * correctly flagged the result as unreachable, and a commented-out corpse is worse documentation
 * than a note saying what was tried and why it failed. This is that note.
 */

/**
 * Candle band in PIXELS, from the canvas.
 *
 * Candles are the only strongly red/green marks on the pane; beads are yellow/magenta and the
 * grid is grey. Classifying by hue separates them without needing the chart's internal state.
 */
function candleBandPx(data, w, h, ch) {
  let minY = Infinity, maxY = -Infinity, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = ch === 4 ? data[i + 3] : 255;
      if (a < 40) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 70 || mx - mn < 45) continue; // dim or grey — grid, background, axis
      const green = g === mx && g - Math.max(r, b) > 35;
      const red = r === mx && r - Math.max(g, b) > 35 && b < 120; // exclude magenta put beads
      if (!green && !red) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
  }
  if (!n || minY === Infinity) return null;
  return { minY, maxY, heightPx: maxY - minY, pixels: n };
}

/** Distinct bead ROWS: cluster centres grouped by y. A "row" is one strike's rail. */
function beadRows(clusters, tolPx = 4) {
  const ys = clusters.map((c) => c.cy ?? c.y).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ys.length) return 0;
  let rows = 1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > tolPx) rows++;
  return rows;
}

async function analyzeShot(shotPath) {
  const sharp = require("sharp");
  const { data, info } = await sharp(shotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const clusters = clusterBeadPixels(data, info.width, info.height, info.channels);
  const summary = summarizeBeads(clusters);
  const band = candleBandPx(data, info.width, info.height, info.channels);
  return { clusters, summary, band, canvasH: info.height };
}

async function measureFrame(page, label, outPrefix) {
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
  if (!box) return { label, error: "no chart canvas" };
  const shot = path.join(OUT, `${outPrefix}.png`);
  await page.screenshot({
    path: shot,
    clip: {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width: Math.floor(box.width),
      height: Math.floor(box.height),
    },
  });
  const { clusters, summary, band } = await analyzeShot(shot);
  const rows = beadRows(clusters);
  // Candle share of the PANE. Both numbers come off the same clipped canvas, so they share a
  // coordinate system — mixing a viewport-space axis with canvas-space pixels is how an earlier
  // attempt at this produced three different answers for three tickers and had to be thrown away.
  const candleShare = band && box.height > 0 ? band.heightPx / box.height : null;
  return {
    label,
    shot,
    beads: summary.count,
    radiusP10: summary.radiusP10,
    radiusP50: summary.radiusP50,
    radiusP90: summary.radiusP90,
    radiusRatio: summary.radiusRatio,
    lumSpread: summary.lumSpread,
    rows,
    candleShare,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`SKIP: ${session.reason}`); process.exit(2); }

  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/vector`, cookie: session.cookieHeader, viewport: VIEWPORT,
    desktop: true, requestTimeoutMs: 60_000,
  });

  const rows = [];
  const builds = new Set();
  try {
    for (const ticker of TICKERS) {
      let page;
      const errors = [];
      try {
        // Re-mint before EVERY ticker: the JWT is short-lived, this run drives the desk for many
        // minutes, and a lapsed cookie bounces navigation through sign-in, which the tunnel cannot
        // complete — the page then dies as ERR_TOO_MANY_REDIRECTS and reads as an outage.
        const fresh = await session.refresh?.();
        if (fresh?.cookieHeader) await applyCookieToContext(ctx, fresh.cookieHeader, `${BASE}/vector`);
        page = await ctx.newPage();
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));

        await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(ticker)}`, {
          waitUntil: "domcontentloaded", timeout: 90_000,
        });
        await page.waitForTimeout(SETTLE_MS);
        builds.add(await buildFingerprint(page));

        // Which recorder lane this ticker landed in — observed, never assumed (the roster is
        // dynamic and sticky, so a hard-coded list would go stale silently).
        const lane = await page.evaluate(() => {
          const el = document.querySelector("[data-wall-trail-sec]");
          if (el) return Number(el.getAttribute("data-wall-trail-sec"));
          const m = document.documentElement.innerHTML.match(/"wallTrailSec"\s*:\s*(\d+)/);
          return m ? Number(m[1]) : null;
        });

        const nodesVal = await (async () => {
          const s = vis(page, "vector-nodes-select");
          return (await s.count()) ? await s.inputValue().catch(() => null) : null;
        })();

        for (const tf of TIMEFRAMES) {
          if (TIMEFRAMES.length > 1 || tf !== "3") {
            const sel = vis(page, "vector-tf-custom");
            if (await sel.count()) {
              await sel.selectOption(String(tf)).catch(() => {});
              await page.waitForTimeout(SWITCH_MS);
            }
          }
          const m = await measureFrame(page, `${ticker} tf=${tf}m`, `m-${ticker}-tf${tf}`);
          rows.push({ ticker, lane, nodes: nodesVal, tf, dte: "default", errors: errors.length, ...m });
        }

        for (const dte of DTES) {
          const chip = vis(page, `vector-dte-${dte}`);
          if (!(await chip.count())) continue;
          await chip.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(SWITCH_MS);
          const m = await measureFrame(page, `${ticker} dte=${dte}`, `m-${ticker}-dte-${dte}`);
          rows.push({ ticker, lane, nodes: nodesVal, tf: TIMEFRAMES[0], dte, errors: errors.length, ...m });
        }

        if (FULLSCREEN.includes(ticker)) {
          const ft = vis(page, "vector-focus-toggle");
          if (await ft.count()) {
            await ft.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(4000);
            // Reachability, not presence: the #2333 bug had every control rendered and none of
            // them clickable, which presence checks cannot distinguish.
            const reach = await page.evaluate(() => {
              const want = ["vector-nodes-select","vector-replay-toggle","vector-indicator-trigger",
                            "vector-draw-tools-trigger","vector-ticker-search","vector-focus-toggle"];
              return want.map((id) => {
                const el = document.querySelector(`[data-testid=${id}]`);
                const els = Array.from(document.querySelectorAll(`[data-testid=${id}]`))
                  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
                const t = els[els.length - 1] || el;
                if (!t) return { id, present: false, reachable: false };
                const r = t.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { id, present: true, reachable: !!hit && (t.contains(hit) || hit === t) };
              });
            });
            const m = await measureFrame(page, `${ticker} FULLSCREEN`, `m-${ticker}-fullscreen`);
            rows.push({ ticker, lane, nodes: nodesVal, tf: TIMEFRAMES[0], dte: "fullscreen",
                        errors: errors.length, reach, ...m });
            await ft.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(2500);
          }
        }

        if (COMPARE.includes(ticker)) {
          const enter = vis(page, "vector-enter-compare");
          if (await enter.count()) {
            const before = page.url();
            await enter.click({ timeout: 8000 }).catch(() => {});
            let url = before;
            for (let i = 0; i < 15 && url === before; i++) { await page.waitForTimeout(1000); url = page.url(); }
            await page.waitForTimeout(9000);
            const st = await page.evaluate(() => {
              // Query NODES by CLASS: the compare-pane branch passes exposeTestIds={false} on
              // purpose (four panes would emit one id four times), so a testid count reads 0 for a
              // control that is on screen.
              const sel = Array.from(document.querySelectorAll("select.vector-desk-seg-select"))
                .filter((e) => e.getBoundingClientRect().width > 0);
              return { entered: /compare=/.test(location.href), nodes: sel.map((e) => e.value),
                       exitPresent: !!document.querySelector("[data-testid=vector-compare-exit]") };
            });
            const exit = vis(page, "vector-compare-exit");
            let left = false;
            if (await exit.count()) {
              const b2 = page.url();
              await exit.click({ timeout: 8000 }).catch(() => {});
              let a2 = b2;
              for (let i = 0; i < 15 && a2 === b2; i++) { await page.waitForTimeout(1000); a2 = page.url(); }
              left = a2 !== b2 && !/compare=/.test(a2);
            }
            rows.push({ ticker, lane, tf: "-", dte: "compare", errors: errors.length,
                        compare: { ...st, exitLeft: left } });
          }
        }
      } catch (err) {
        // One ticker must never end the run — an earlier pass lost every captured result to a
        // mid-run auth bounce on the last ticker.
        rows.push({ ticker, error: String(err?.message || err).slice(0, 140) });
      } finally {
        await page?.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  const pct = (v) => (v == null ? "  -  " : `${(v * 100).toFixed(1)}%`);
  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, builds: [...builds], counts, rows }, null, 2));
  } else {
    console.log(`VECTOR RTH MATRIX — ${BASE} @ ${VIEWPORT}`);
    console.log(`tunnel: ${counts.ok} ok, ${counts.fail} fail | builds: ${[...builds].join(",")}`);
    console.log("");
    console.log("ticker  lane nodes tf/dte      beads rows  r_p10/p50/p90   ratio  lum   candle%  err");
    for (const r of rows) {
      if (r.error) { console.log(`${r.ticker.padEnd(7)} FAILED — ${r.error}`); continue; }
      if (r.compare) {
        console.log(`${r.ticker.padEnd(7)} ${String(r.lane ?? "-").padEnd(4)} COMPARE entered=${r.compare.entered} nodes=[${r.compare.nodes.join(",")}] exitLeft=${r.compare.exitLeft}`);
        continue;
      }
      const fs_ = r.reach ? `  FS:${r.reach.filter((x) => x.reachable).length}/${r.reach.length}` : "";
      console.log(
        `${r.ticker.padEnd(7)} ${String(r.lane ?? "-").padEnd(4)} ${String(r.nodes ?? "-").padEnd(5)} ` +
        `${String(r.dte === "default" ? `${r.tf}m` : r.dte).padEnd(11)} ` +
        `${String(r.beads ?? "-").padStart(5)} ${String(r.rows ?? "-").padStart(4)}  ` +
        `${String(r.radiusP10 ?? "-").padStart(4)}/${String(r.radiusP50 ?? "-").padStart(4)}/${String(r.radiusP90 ?? "-").padStart(4)}  ` +
        `${String(r.radiusRatio ?? "-").padStart(5)}  ${String(r.lumSpread ?? "-").padStart(4)}  ` +
        `${pct(r.candleShare).padStart(7)}  ${r.errors}${fs_}`
      );
    }
    const measured = rows.filter((r) => r.beads != null);
    const zero = measured.filter((r) => r.beads === 0);
    const flat = measured.filter((r) => r.beads > 20 && Number(r.radiusRatio) < 1.5);
    const thin = measured.filter((r) => r.candleShare != null && r.candleShare < CANDLE_SHARE_TARGET * 0.6);
    console.log("");
    console.log(`frames measured: ${measured.length} | zero-bead: ${zero.length} | flat-radius(<1.5x): ${flat.length} | candle-share far under target: ${thin.length}`);
    if (zero.length) console.log(`  ZERO BEADS: ${zero.map((r) => `${r.ticker}/${r.dte === "default" ? r.tf + "m" : r.dte}`).join(", ")}`);
    if (flat.length) console.log(`  FLAT RADIUS: ${flat.map((r) => `${r.ticker}/${r.dte === "default" ? r.tf + "m" : r.dte}`).join(", ")}`);
    if (thin.length) console.log(`  THIN CANDLES: ${thin.map((r) => `${r.ticker} ${(r.candleShare * 100).toFixed(0)}%`).join(", ")}`);
  }
})().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });

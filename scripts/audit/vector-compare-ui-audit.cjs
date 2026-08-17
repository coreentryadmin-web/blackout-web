/**
 * Vector COMPARE-mode live UI audit — 2 / 3 / 4 panes, bead dynamics per pane, and the two exits.
 *
 * WHY THIS EXISTS. `vector-ui-walkthrough.cjs` clicks every control on the SINGLE-ticker desk and
 * never enters compare mode, so the pane grid — a different component tree with its own bead render
 * profile (BEAD_TUNING_COMPARE) and its own navigation surface — had no coverage at all. Two
 * member-reported symptoms landed in that blind spot at once: "Exit compare does nothing" and
 * "I can't navigate anywhere else while in compare".
 *
 * WHAT IT ASSERTS, per pane count:
 *   - the grid mounted the expected number of panes, each with its own chart canvas carrying real
 *     pixels (a 0x0 canvas renders as an empty black box and is NOT a rendered chart);
 *   - each pane's ladder payload carries a real spread of per-strike gamma share, which is what the
 *     bead size channel is driven by — see readBeadPayloadSpread for exactly what that does and
 *     does NOT prove (it is an input check, not a pixel check, and the comment says so);
 *   - no error text, and the nav still renders signed-in.
 *
 * AND THE TWO NAVIGATION EXITS, which are the reported bugs:
 *   - EXIT BUTTON: click `vector-compare-exit`, then assert the URL lost `compare` AND the pane
 *     grid actually unmounted. Asserting only the URL would have PASSED on the broken build — the
 *     push worked; the client ignored it and kept the grid mounted (see resolveCompareRaw).
 *   - CROSS-ROUTE LINK: navigate to another desk page from inside compare and assert we land there.
 *
 * WHAT IT CANNOT ASSERT — say so, do not imply otherwise:
 *   - SSE push freshness. The tunnel is one-shot request/response; the desk falls back to polling.
 *   - Bead CADENCE. Proving 5s vs 15s needs a timed capture, not a snapshot — that is
 *     `vector-live-e2e.mjs` stage B's job, against the API, and it is not duplicated here.
 *   - Bead RADII AS DRAWN. The rail is an ISeriesPrimitive painting onto the candle canvas with no
 *     per-bead DOM node and no public accessor for its radius map, so "N distinct sizes on screen"
 *     is not measurable today. The input side is measured instead; a pixel-true check needs a debug
 *     accessor on the primitive and is a deliberate follow-up, not a silent omission.
 *   - Whether the beads are in the RIGHT places. This checks the size channel has live input and
 *     that the pane rendered, not that the underlying gamma is correct.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 *
 * Run from the REPO ROOT:
 *   node scripts/audit/vector-compare-ui-audit.cjs [--out=DIR] [--json]
 * Exits non-zero if any state fails an assertion.
 */
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const OUT = arg("out", process.env.SHOT_OUT || ".");
const AS_JSON = argv.includes("--json");

/**
 * Deliberately mixed cohorts, not four index names.
 *
 * The bead-sizing defect only reproduced on SINGLE NAMES — the absolute-$ ladder was calibrated on
 * SPX, so an all-index compare would have rendered a healthy spread of radii and reported the bug
 * fixed while every member watching NVDA/META saw uniform dots. Each case therefore carries at
 * least one single name, and the 4-pane case is entirely single names.
 */
const CASES = [
  { id: "2-pane", tickers: ["SPX", "NVDA"] },
  { id: "3-pane", tickers: ["SPY", "QQQ", "TSLA"] },
  { id: "4-pane", tickers: ["NVDA", "META", "AMD", "TSLA"] },
];

const BROKEN_TEXT = /something went wrong|we couldn['’]t load|failed to load|unhandled runtime error|application error/i;

/** Compare is gated below 1280px by design (`vector-compare-mobile-gate`) — audit it wide. */
const VIEWPORT = "1680x1050";

/**
 * BEAD SIZE CHANNEL — what this can and cannot prove. Read before trusting the verdict.
 *
 * The rail is drawn by an `ISeriesPrimitive` onto the SAME canvas as the candles, so there is no
 * per-bead DOM node to measure and no colour-sampling that would be reading the rail rather than
 * the chart. The primitive keeps its drawn radii in a private `_targetHalf` map with no public
 * accessor, so a pixel-true "these beads have N distinct radii" assertion is NOT available today.
 *
 * What IS available, and what this measures instead: the size channel's INPUT. Bead radius is
 * `targetHalfPx(pct, …)`, strictly monotone in the per-strike gamma share `pct` (unit-tested in
 * vector-wall-rail-core.test.ts). So a rail whose payload carries a wide spread of `pct` MUST
 * render a spread of radii, and a rail whose payload is flat cannot. The #2271 defect was a
 * ladder that mapped a healthy pct spread onto ONE radius — that regression is now caught by the
 * unit tests on the pure function, and what this harness adds is the live half those tests cannot
 * see: that compare panes are actually being fed a varied payload per ticker, per pane.
 *
 * Do NOT report this as "beads render at N distinct sizes on screen". It is not that measurement.
 * The honest pixel check is a follow-up that needs a debug accessor on the primitive.
 */
async function readBeadPayloadSpread(page, tickers) {
  const out = {};
  for (const t of tickers) {
    // A failed in-page fetch must NOT take the run down. The first live run of this harness died
    // here: one `TypeError: Failed to fetch` propagated out of evaluate and killed every remaining
    // case, so a run that had already captured three healthy pane grids reported nothing at all.
    // An unreachable ladder is a datum about one ticker, not a reason to lose the other twelve.
    out[t] = await page.evaluate(async (ticker) => {
      try {
        const r = await fetch(`/api/market/vector/gex-ladder?ticker=${encodeURIComponent(ticker)}&dte=weekly`);
        if (!r.ok) return { error: `HTTP ${r.status}` };
        const j = await r.json();
        const pcts = (j?.ladder?.rows ?? [])
          .map((x) => Number(x.pct))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (!pcts.length) return { rows: 0, min: null, max: null, ratio: null };
        const min = Math.min(...pcts);
        const max = Math.max(...pcts);
        return { rows: pcts.length, min, max, ratio: min > 0 ? max / min : null };
      } catch (e) {
        return { error: `fetch failed: ${String(e && e.message).slice(0, 80)}` };
      }
    }, t).catch((e) => ({ error: `evaluate failed: ${String(e && e.message).split("\n")[0].slice(0, 80)}` }));
  }
  return out;
}

/** Read the compare grid at one instant. */
async function inspectCompare(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const panes = [...document.querySelectorAll(".vector-compare-pane")].filter(visible);
    const paneInfo = panes.map((pane) => {
      const canvases = [...pane.querySelectorAll("canvas")];
      const biggest = canvases.reduce((a, c) => Math.max(a, c.width * c.height), 0);
      const ticker = pane.querySelector(".vector-compare-pane-ticker")?.textContent?.trim() ?? null;
      const spot = pane.querySelector(".vector-compare-pane-spot")?.textContent?.trim() ?? null;
      return { ticker, spot, canvasCount: canvases.length, biggestCanvas: biggest };
    });
    return {
      url: location.pathname + location.search,
      paneCount: panes.length,
      panes: paneInfo,
      exitPresent: Boolean(document.querySelector("[data-testid=vector-compare-exit]")),
      bodyText: (document.body.innerText || "").slice(0, 120000),
      nav: document.querySelector(".nav-signin") ? "signed-out" : "signed-in",
    };
  });
}

function assertCompareState(snap, expectedTickers, spread) {
  const fails = [];
  const m = BROKEN_TEXT.exec(snap.bodyText);
  if (m) fails.push(`error text on page: "${m[0]}"`);
  if (snap.nav === "signed-out") fails.push("nav rendered signed-out on an authenticated desk page");

  if (snap.paneCount !== expectedTickers.length) {
    fails.push(`grid mounted ${snap.paneCount} pane(s), expected ${expectedTickers.length}`);
  }
  if (!snap.exitPresent) fails.push("Exit compare control is not rendered");

  for (const p of snap.panes) {
    const who = p.ticker ?? "(unlabelled pane)";
    if (!(p.biggestCanvas > 10000)) {
      fails.push(`${who}: no chart canvas with real pixels (largest ${p.biggestCanvas}px²)`);
    }
    if (p.spot == null || p.spot === "—") fails.push(`${who}: pane header shows no spot`);
  }

  // Size-channel INPUT (see readBeadPayloadSpread — this is not a pixel measurement). A payload
  // whose strongest strike is barely stronger than its weakest cannot produce visibly different
  // beads no matter how correct the renderer is. An EMPTY ladder is not a failure: off-hours and
  // on thin names a rail with nothing to draw is honest, and flagging it would make this lie.
  for (const [ticker, s] of Object.entries(spread ?? {})) {
    if (s.error) {
      fails.push(`${ticker}: ladder payload unavailable (${s.error}) — size channel NOT checked`);
    } else if (s.rows > 3 && s.ratio != null && s.ratio < 1.5) {
      fails.push(
        `${ticker}: ${s.rows} strikes but max/min pct is only ${s.ratio.toFixed(2)}× — flat payload, beads cannot differentiate`
      );
    }
  }

  const shown = snap.panes.map((p) => p.ticker).filter(Boolean);
  const missing = expectedTickers.filter((t) => !shown.includes(t));
  if (missing.length) fails.push(`requested but not rendered: ${missing.join(", ")}`);
  return fails;
}

async function run(session) {
  const first = `${BASE}/vector?compare=${CASES[0].tickers.join(",")}`;
  const { browser, ctx, counts } = await createTunneledContext({
    url: first,
    cookie: session.cookieHeader,
    viewport: VIEWPORT,
    desktop: true,
    // A 4-pane compare fires four ticker's worth of walls/heatmap/ladder calls at once, and a
    // forced GEX rebuild has a measured multi-second tail. The lib's 20s default timed the first
    // live run's Vector calls out and rendered empty panes — latency reported as a missing feature.
    requestTimeoutMs: 45_000,
  });
  const page = await ctx.newPage();
  const results = [];
  const dom = new URL(first).hostname;
  let lastRefresh = Date.now();

  // The minted __session JWT dies ~72s after issue and this run is several minutes long. Without
  // re-minting into the CONTEXT (not just the Node-side header), the desk's own fetches 401 and the
  // panes render empty — which reads as a product fault. See prod-clerk-session.mjs.
  const keepSessionAlive = async () => {
    if (Date.now() - lastRefresh < 40_000) return;
    const next = await session.refresh?.().catch(() => null);
    if (!next) return;
    lastRefresh = Date.now();
    await ctx.addCookies([
      { name: "__session", value: next.jwt, domain: dom, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  };

  try {
    for (const c of CASES) {
      const url = `${BASE}/vector?compare=${c.tickers.join(",")}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await keepSessionAlive();
      // Compare loads its seeds with bounded concurrency (2 at a time), so a 4-pane grid needs
      // roughly twice the settle of a 2-pane one before absence means anything.
      await page.waitForTimeout(9000 + c.tickers.length * 2500);

      const shot = path.join(OUT, `vector-compare-${c.id}.png`);
      await page.screenshot({ path: shot, timeout: 20000 }).catch(() => {});
      const snap = await inspectCompare(page);
      // Payload spread is read INSIDE the auth window of this navigation — the JWT dies ~72s after
      // issue, so deferring it to the end of the run would 401 and read as a missing ladder.
      const spread = await readBeadPayloadSpread(page, c.tickers);
      results.push({
        id: c.id,
        label: `${c.tickers.length} panes: ${c.tickers.join(" / ")}`,
        fails: assertCompareState(snap, c.tickers, spread),
        paneCount: snap.paneCount,
        panes: snap.panes,
        spread,
        shot,
      });
    }

    // ---- EXIT BUTTON. The reported bug, and the reason the URL alone is not the assertion. ----
    await keepSessionAlive();
    const exitFails = [];
    const before = await inspectCompare(page);
    if (!before.exitPresent) {
      exitFails.push("Exit compare control absent — could not exercise the exit path");
    } else {
      await page.locator("[data-testid=vector-compare-exit]").last().click({ timeout: 8000 }).catch((e) => {
        exitFails.push(`click threw: ${String(e.message).split("\n")[0].slice(0, 120)}`);
      });
      await page.waitForTimeout(6000);
      const after = await inspectCompare(page);
      if (/[?&]compare=/.test(after.url)) exitFails.push(`URL still carries compare: ${after.url}`);
      // THE assertion. On the broken build the push succeeded and this stayed > 0.
      if (after.paneCount > 0) {
        exitFails.push(`${after.paneCount} compare pane(s) still mounted after Exit — the member is trapped`);
      }
      const single = await page.$(".vector-chart-terminal-chart");
      if (!single) exitFails.push("single-ticker desk did not render after leaving compare");
      await page.screenshot({ path: path.join(OUT, "vector-compare-after-exit.png"), timeout: 20000 }).catch(() => {});
    }
    results.push({ id: "exit-button", label: "Exit compare → desk", fails: exitFails, paneCount: null, panes: [], spread: {} });

    // ---- CROSS-ROUTE NAV out of compare (the "can't reach SPX Slayer" report). ----
    await keepSessionAlive();
    const navFails = [];
    await page.goto(`${BASE}/vector?compare=${CASES[2].tickers.join(",")}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(12000);
    const link = page.locator('a[href^="/nighthawk"]').filter({ visible: true }).first();
    if (!(await link.count())) {
      navFails.push("no visible link to another desk page from inside compare — nav surface missing");
    } else {
      await link.click({ timeout: 8000 }).catch((e) => {
        navFails.push(`nav click threw: ${String(e.message).split("\n")[0].slice(0, 120)}`);
      });
      await page.waitForTimeout(8000);
      const where = await page.evaluate(() => location.pathname + location.search);
      if (!where.startsWith("/nighthawk")) navFails.push(`still on ${where} after clicking a /nighthawk link`);
      const stuck = await inspectCompare(page);
      if (stuck.paneCount > 0) navFails.push(`${stuck.paneCount} compare pane(s) still mounted on another route`);
      await page.screenshot({ path: path.join(OUT, "vector-compare-cross-route.png"), timeout: 20000 }).catch(() => {});
    }
    results.push({ id: "cross-route-nav", label: "compare → /nighthawk", fails: navFails, paneCount: null, panes: [], spread: {} });
  } finally {
    await browser.close();
  }
  return { results, counts };
}

(async () => {
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
    console.log(JSON.stringify({ base: BASE, counts, results }, null, 2));
  } else {
    console.log(`\n=== VECTOR COMPARE UI AUDIT @ ${BASE} (${VIEWPORT})`);
    console.log(`routed: ${counts.ok} ok, ${counts.fail} fail, ${counts.streamsBuffered} streams buffered\n`);
    for (const r of results) {
      console.log(`  ${r.fails.length ? "FAIL" : "ok  "} ${r.id.padEnd(16)} ${r.label}`);
      for (const p of r.panes) {
        console.log(
          `         ${String(p.ticker).padEnd(6)} spot=${String(p.spot).padEnd(10)} canvas=${p.biggestCanvas}px²`
        );
      }
      for (const [t, s] of Object.entries(r.spread ?? {})) {
        console.log(
          `         ${t.padEnd(6)} ladder rows=${s.rows ?? "-"} pct spread=${s.ratio != null ? `${s.ratio.toFixed(1)}x` : s.error ?? "-"}`
        );
      }
      for (const f of r.fails) console.log(`         ${f}`);
    }
  }

  // Routing failures mean assets never loaded: the run describes a half-empty page and its passes
  // are not evidence. A failure of the RUN, not of the desk — but still non-zero.
  const failed = results.filter((r) => r.fails.length).length;
  console.log(`\nstates failing: ${failed} · routing failures: ${counts.fail}`);
  process.exit(failed > 0 || counts.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});

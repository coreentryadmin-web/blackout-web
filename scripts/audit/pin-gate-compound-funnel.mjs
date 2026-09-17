#!/usr/bin/env node
/**
 * PIN-ORIGIN GATE-COMPOUND FUNNEL — closes the exact gap named in INTENTIONAL-DESIGN.md item #10's
 * "natural next step" (2026-09-17).
 * ============================================================================================
 *
 * WHY THIS EXISTS
 * ----------------
 * `zerodte-gate-compound-funnel.mjs` (2026-09-08/09) measured the REAL joint pass rate of the
 * hard-gate stack (gates.ts's evaluateZeroDteGates) for FLOW-origin setups: ~0% joint survival at
 * RTH (n=26), `score_floor` the dominant isolated chokepoint (84.6%). That tool's own header has
 * always disclosed "BREAKOUT/PIN origins" as NOT measured by its hard-gate section — PIN discovery
 * itself (`discoverPinSetups`) carries a transitive `server-only` import and cannot even be called
 * from that script's sandbox environment, so it could only attempt a live call and report the
 * import failure honestly.
 *
 * `pin-condor-funnel-measure.mjs` (also 2026-09-17, INTENTIONAL-DESIGN.md item #10) found the
 * upstream half of the answer: PIN discovery is NOT dead (221 real candidate builds/14d via
 * CloudWatch) and flags are NOT off, but 0 PIN-origin setups ever appear in the 90-day committed
 * ledger. It named the most likely explanation — the SAME gate-compound funnel already measured
 * for FLOW likely applies to PIN too — as a real, evidence-backed hypothesis NOT YET PROVEN, and
 * named "extend zerodte-gate-compound-funnel.mjs's methodology to PIN-origin setups specifically"
 * as the natural next step. This script IS that next step.
 *
 * WHAT'S REAL vs. APPROXIMATED (same honesty discipline as every sibling tool)
 * ------------------------------------------------------------------------------
 * REAL (production code, no reimplementation):
 *   - evaluatePinRegime / pinScore (pin-source.ts) — the REAL regime test + REAL 0-100 score
 *     formula every live PIN candidate is built from.
 *   - computeGexWalls / mapFromStrikeTotalsRecord (gex-wall-levels.ts) — the REAL wall-dominance
 *     extraction (same recipe gex-wall-snapshot-poll.mjs and pin-condor-funnel-measure.mjs use).
 *   - computeIntradayRead / marketBias / intradayScoreAdjust (intraday.ts) — REAL VWAP/trend read,
 *     fed REAL Polygon minute bars per ticker + SPY (identical to the FLOW section's own call).
 *   - computeConfluence (confluence.ts) — the REAL G-12 confluence tier.
 *   - evaluateZeroDteGates (gates.ts) — the REAL, unmodified hard-gate stack. Every block this
 *     script reports is a real gate function returning a real verdict on a PIN-shaped input, not a
 *     guess about what it would do.
 *   - Real day-open VIX (Polygon I:VIX daily bar), real SPY intraday bias.
 *
 * REAL DATA, DIFFERENT FETCH PATH (disclosed, mirrors pin-condor-funnel-measure.mjs's own
 * precedent): `gexPositioningFromHeatmap`/`discoverPinSetups` carry a transitive `server-only`
 * import and cannot be called from a plain Node script. This script fetches the SAME live
 * `GET /api/market/gex-heatmap?ticker=<T>` route `pin-discovery.ts`'s own `fetchGexHeatmap` reads,
 * one temp Clerk session (`audit-auth-fetch.mjs`, released at the end) — same route, different
 * caller, not a re-derivation. The evidence-gate/board wiring layer (`mergeSameTickerDiscovery`,
 * `enrichSetup`, `deriveContractHorizon`) is NOT replayed — a PIN candidate's `direction`/`score`
 * are built here directly from `evaluatePinRegime`/`pinScore`, matching exactly what
 * `pin-discovery.ts`'s own `buildPinSetup` would produce for a passing regime.
 *
 * APPROXIMATED / NOT EXERCISED (identical disclosure to zerodte-gate-compound-funnel.mjs, same
 * gates, same reasons — copied verbatim rather than re-derived so the two reports stay comparable):
 *   - G-5 governor: evaluated with an EMPTY book (no open plans, no stops) — understates real bite.
 *   - G-6 cross-system conflict: no live Slayer/Night Hawk cross-desk state.
 *   - G-7 macro: treated as zero events (no calendar fetch).
 *   - G-8/G-9 plan-quality, G-11 halt/earnings: no live option-quote/earnings-feed fetch, skipped.
 *   - Cortex veto layer: NOT run here — this script only measures gates.ts's hard-gate stack, same
 *     scope boundary as the FLOW tool. (Item #9 already covers Cortex's regime-oppose for condor.)
 *   - PIN_TEMPORAL_STABILITY (2+ agreeing GEX snapshots ~5min apart, confirmed ON in production):
 *     this is a SINGLE live snapshot. The temporal gate sits BEFORE a candidate would even reach
 *     the hard-gate stack in production, so a single-snapshot PASS here is upstream-optimistic
 *     (production requires MORE to commit, never less) — disclosed, not glossed over.
 *
 * USAGE
 *   node --import tsx scripts/audit/pin-gate-compound-funnel.mjs [--tickers=A,B,...] [--now-et=HH:MM] [--json]
 *
 * Never gates anything. Read-only. One temp Clerk user for the GEX-heatmap fetches, released in a
 * `finally`. Secrets from env only (POLYGON_API_KEY via lib/providers/polygon.ts).
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const EMIT_JSON = Boolean(argv.json);
const NOW_ET_OVERRIDE = (() => {
  if (!argv["now-et"] || argv["now-et"] === "true") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(argv["now-et"]));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
})();
const TICKER_OVERRIDE = argv.tickers && argv.tickers !== "true"
  ? String(argv.tickers).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  : null;

// Mirrored (not imported) from pin-discovery.ts's own DEFAULT_PIN_UNIVERSE, same reason
// pin-condor-funnel-measure.mjs mirrors it: that module's top-level import chain is
// server-only-guarded. Keep in lockstep with pin-discovery.ts if that list changes.
const DEFAULT_PIN_UNIVERSE = [
  "SPX", "NDX", "SPY", "QQQ", "IWM", "DIA",
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "AMD",
  "NFLX", "CRM", "AVGO", "COST", "LLY", "JPM", "V", "MA",
  "UNH", "WMT", "PG", "JNJ", "HD", "ADBE", "INTC", "MU",
];

const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");
const { evaluatePinRegime, pinScore } = await import(`${SRC}lib/zerodte/pin-source.ts`);
const { computeGexWalls, mapFromStrikeTotalsRecord } = await import(`${SRC}lib/providers/gex-wall-levels.ts`);
const { evaluateZeroDteGates } = await import(`${SRC}lib/zerodte/gates.ts`);
const { computeConfluence } = await import(`${SRC}lib/zerodte/confluence.ts`);
const { computeIntradayRead, marketBias, intradayScoreAdjust } = await import(`${SRC}lib/zerodte/intraday.ts`);
const { fetchStockMinuteBars } = await import(`${SRC}lib/providers/polygon.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const line = (c = "─", w = 100) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function etMinutesOf(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

async function main() {
  const nowMs = Date.now();
  const today = etYmd(nowMs);
  const realNowEtMinutes = etMinutesOf(nowMs);
  const nowEtMinutes = NOW_ET_OVERRIDE ?? realNowEtMinutes;
  const tickers = TICKER_OVERRIDE ?? [...DEFAULT_PIN_UNIVERSE];

  console.log(line("═"));
  console.log(`  PIN-ORIGIN GATE-COMPOUND FUNNEL — as-of ${today} ${String(Math.floor(realNowEtMinutes / 60)).padStart(2, "0")}:${String(realNowEtMinutes % 60).padStart(2, "0")} ET (real)`);
  if (NOW_ET_OVERRIDE != null) {
    console.log(`  ⚠ GATE-CLOCK OVERRIDE: evaluateZeroDteGates fed ${String(Math.floor(nowEtMinutes / 60)).padStart(2, "0")}:${String(nowEtMinutes % 60).padStart(2, "0")} ET instead`);
  }
  console.log(`  universe: ${tickers.length} tickers (mirrors pin-discovery.ts's DEFAULT_PIN_UNIVERSE)`);
  console.log(line("═"));

  let pinCandidates = [];
  const snapshotRows = [];
  try {
    // 1) GEX heatmap per ticker (real route, real data) → real evaluatePinRegime/pinScore.
    console.log(`\n[1] Fetching live GEX-wall data for ${tickers.length} tickers…`);
    for (const ticker of tickers) {
      const res = await fetchAuditJson("https://blackouttrades.com", `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`);
      if (!res?.ok || !res.json) {
        snapshotRows.push({ ticker, stage: "fetch_failed", detail: `status ${res?.status}` });
        continue;
      }
      const j = res.json;
      const spot = typeof j.spot === "number" ? j.spot : null;
      const gex = j.gex ?? {};
      const callWall = typeof gex.call_wall === "number" ? gex.call_wall : null;
      const putWall = typeof gex.put_wall === "number" ? gex.put_wall : null;
      const gammaPosture = gex.regime?.posture === "long" || gex.regime?.posture === "short" ? gex.regime.posture : null;
      if (!(spot > 0)) {
        snapshotRows.push({ ticker, stage: "no_spot" });
        continue;
      }
      const strikeTotals = gex.strike_totals && typeof gex.strike_totals === "object" ? gex.strike_totals : {};
      const walls = computeGexWalls(mapFromStrikeTotalsRecord(strikeTotals), { spot });
      const callWallPct = callWall != null ? walls.callWalls.find((w) => w.strike === callWall)?.pct ?? null : null;
      const putWallPct = putWall != null ? walls.putWalls.find((w) => w.strike === putWall)?.pct ?? null : null;
      const regime = evaluatePinRegime({ spot, callWall, putWall, callWallPct, putWallPct, gammaPosture });
      if (!regime) {
        snapshotRows.push({ ticker, stage: "no_pin", detail: `posture=${gammaPosture ?? "?"}` });
        continue;
      }
      const score = pinScore(regime);
      snapshotRows.push({ ticker, stage: "pin_regime_qualified", detail: `${regime.fadeDirection} score=${score}`, regime, score });
      pinCandidates.push({ ticker, direction: regime.fadeDirection, score, regime });
    }
    console.log(`    ${pinCandidates.length}/${tickers.length} tickers clear evaluatePinRegime this snapshot`);
    if (!pinCandidates.length) {
      console.log("\n  No PIN candidates this snapshot (regime genuinely absent right now, or off-hours). Funnel ends here — this is a single-snapshot result, re-run at a different time for a different regime read, never treat one empty snapshot as proof the gate stack is the bottleneck.");
      if (EMIT_JSON) {
        console.log("\n<<<JSON>>>");
        console.log(JSON.stringify({ asOf: today, nowEtMinutes, universe: tickers.length, pinCandidates: 0, snapshotRows }, null, 2));
      }
      return;
    }

    // 2) Real day-open VIX + real SPY intraday bias.
    console.log(`\n[2] Fetching real day-open VIX + SPY intraday read…`);
    const vixBar = await fetchAggBars("I:VIX", 1, "day", today, today).catch(() => []);
    const vixDayOpen = Array.isArray(vixBar) && vixBar[0]?.o != null ? Number(vixBar[0].o) : null;
    const spyBars = await fetchStockMinuteBars("SPY", today, today).catch(() => []);
    const spyRead = computeIntradayRead((spyBars ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })));
    const bias = marketBias(spyRead);
    console.log(`    VIX day-open: ${vixDayOpen ?? "—"}  ·  SPY bias: ${bias ?? "unknown"}`);

    // 3) Per-candidate intraday read → real confluence, then the REAL hard-gate stack.
    console.log(`\n[3] Running the REAL evaluateZeroDteGates stack per PIN candidate…`);
    const results = [];
    for (const c of pinCandidates) {
      const bars = await fetchStockMinuteBars(c.ticker, today, today).catch(() => []);
      const read = (bars ?? []).length ? computeIntradayRead(bars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }))) : null;
      const marketAligned = bias == null || bias === "flat" ? null : (bias === "up") === (c.direction === "long");
      const conflict = read ? intradayScoreAdjust(c.direction, read).conflict : false;
      const confluence = computeConfluence({ direction: c.direction, intraday: read, market_aligned: marketAligned }, nowEtMinutes);
      const input = {
        ticker: c.ticker,
        direction: c.direction,
        score: c.score,
        discovery_origin: ["PIN"],
        nowEtMinutes,
        nowMs,
        bias,
        biasAsOfMs: spyRead.last_bar_ms ?? null,
        governor: { open_plans: [], stops: [] }, // APPROXIMATED — see header
        vixDayOpen,
        vixUnavailable: vixDayOpen == null,
        slayerLive: null,
        nighthawkTake: null,
        macroEvents: [],
        plan: null,
        deferPlanQualityGates: true,
        contractHorizon: "ZERO_DTE",
        intradayConflict: conflict,
        market_aligned: marketAligned,
        halted: false,
        haltFeedStale: false,
        earnings: null,
        earningsUnavailable: false,
        confluence,
      };
      const verdict = evaluateZeroDteGates(input);
      results.push({ ticker: c.ticker, direction: c.direction, score: c.score, regime: c.regime, verdict });
    }

    const isolatedFail = new Map();
    for (const r of results) for (const b of r.verdict.blocks) isolatedFail.set(b.code, (isolatedFail.get(b.code) ?? 0) + 1);
    const jointPass = results.filter((r) => r.verdict.verdict === "COMMIT").length;
    const jointBlocked = results.length - jointPass;

    console.log(`\n${line()}`);
    console.log(`  PIN-ORIGIN STAGE-BY-STAGE FUNNEL`);
    console.log(line());
    const row = (label, val, note = "") => console.log(`    ${pad(label, 44)}${padL(val, 6)}   ${note}`);
    row("universe scanned", tickers.length);
    row("↳ pin regime qualified (evaluatePinRegime)", pinCandidates.length);
    row("JOINT COMMIT (clears every hard gate at once)", jointPass, `${results.length ? ((jointPass / results.length) * 100).toFixed(1) : "0"}% of pin candidates`);
    row("JOINT BLOCKED (fails ≥1 gate)", jointBlocked);

    console.log(`\n${line()}`);
    console.log(`  PER-GATE ISOLATED FAILURE RATE  (of ${results.length} pin candidates reaching the hard-gate stack)`);
    console.log(line());
    const sortedGates = [...isolatedFail.entries()].sort((a, b) => b[1] - a[1]);
    if (!sortedGates.length) console.log("    (no gate fired on any candidate)");
    for (const [code, count] of sortedGates) {
      const pct = ((count / results.length) * 100).toFixed(1);
      console.log(`    ${pad(code, 32)}${padL(count, 5)} / ${results.length}   (${padL(pct, 5)}%)`);
    }

    console.log(`\n${line()}`);
    console.log(`  NOT MEASURED THIS RUN (see script header)`);
    console.log(line());
    console.log(`    G-5 governor — evaluated with an EMPTY book`);
    console.log(`    G-6 cross_system_conflict — no live cross-desk state`);
    console.log(`    G-7 macro_hard_block — treated as zero events`);
    console.log(`    G-8/G-9/G-11 plan-quality/halt/earnings — no live quote/halt/earnings fetch`);
    console.log(`    Cortex veto layer — not run here (this measures gates.ts's hard-gate stack only)`);
    console.log(`    PIN_TEMPORAL_STABILITY (2+ agreeing snapshots) — single snapshot only, upstream-optimistic`);

    console.log(`\n${line("═")}`);
    console.log(`  SUMMARY: ${pinCandidates.length} pin-regime-qualified candidates → ${jointPass} commit-eligible on the hard-gate stack (partial context)`);
    console.log(`  Single biggest isolated gate: ${sortedGates[0] ? `${sortedGates[0][0]} (${sortedGates[0][1]}/${results.length})` : "none fired"}`);
    console.log(`  Compare against zerodte-gate-compound-funnel.mjs's FLOW-origin numbers (score_floor 84.6% isolated, ~0% joint, RTH 2026-09-09) to see whether PIN dies at the same chokepoint.`);
    console.log(line("═"));

    if (EMIT_JSON) {
      console.log("\n<<<JSON>>>");
      console.log(JSON.stringify({
        asOf: today,
        nowEtMinutes,
        vixDayOpen,
        bias,
        universe: tickers.length,
        pinCandidates: pinCandidates.length,
        funnel: { jointPass, jointBlocked },
        isolatedFailureByGate: Object.fromEntries(sortedGates),
        perCandidate: results.map((r) => ({ ticker: r.ticker, direction: r.direction, score: r.score, verdict: r.verdict.verdict, blocks: r.verdict.blocks.map((b) => b.code) })),
        snapshotRows,
      }, null, 2));
    }
  } finally {
    await releaseAuditClerkSession();
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * PIN -> CONDOR discovery funnel — LIVE measurement (2026-09-17, follow-up to the "0 condor
 * commits in 90 days" finding in cortex-condor-oppose-measure.mjs / INTENTIONAL-DESIGN.md).
 *
 * WHY THIS EXISTS. That measurement found 0 of 411 committed 0DTE plays in a 90-day window carry
 * `play_type: "CONDOR"`. Before treating that as a bug, this checks the two most likely honest
 * explanations against real data: (1) is the condor engine actually flag-DISABLED in production
 * (confirmed NO — `blackout-production/app/env` carries no ZERODTE_CONDOR/ZERODTE_SRC_PIN/
 * ZERODTE_WHOLE_MARKET/ZERODTE_CONDOR_ROOTS override at all, so every one of them runs its
 * documented default-ON value, verified by reading both the secret AND this process's own
 * `condorFlagEnabled()`/`pinSourceEnabled()` — same code, same defaults); (2) is the PIN->CONDOR
 * routing funnel (pin-discovery.ts) simply NARROW BY DESIGN under real market conditions —
 * `evaluatePinRegime` requires a genuine two-sided, dominant, long-gamma, band-contained,
 * off-center-but-not-hugging bracket, and `condorSellRegime` on top of that (only for SPX/NDX, the
 * only cash-settled roots) additionally requires >=6% bracket dominance, <=3% band width, <=0.6
 * offset — AND (in production, `PIN_TEMPORAL_STABILITY=1`, confirmed live via Secrets Manager) the
 * SAME bracket must persist stably across >=2 GEX snapshots ~5min apart before a PIN commits at
 * all, a requirement this tool does NOT replay (needs the live Redis `gex-history` ring,
 * unreachable from this sandbox — disclosed, not glossed over).
 *
 * THIS TOOL RUNS THE REAL, UNMODIFIED, IMPORTED FUNCTIONS — `evaluatePinRegime`/`pinScore` (pin-
 * source.ts), `condorSellRegime`/`condorEligibleTicker` (condor.ts), `computeGexWalls`/
 * `mapFromStrikeTotalsRecord` (gex-wall-levels.ts) — against REAL live GEX-wall data fetched from
 * the SAME `GET /api/market/gex-heatmap?ticker=<T>` route pin-discovery.ts's own `fetchGexHeatmap`
 * reads (one temp Clerk session, same auth pattern as `gex-wall-snapshot-poll.mjs`). Nothing is
 * reimplemented or mirrored except the ticker universe list itself — these pure functions have no
 * `server-only`/DB import, so they resolve cleanly via `node --import tsx` with a bare `@/`
 * specifier (verified: `gex-positioning.ts`, `polygon-options-gex.ts`, AND `pin-discovery.ts`
 * itself all carry a `server-only` import transitively and cannot be used this way — this is why
 * the wall/pct extraction below mirrors `gex-wall-snapshot-poll.mjs`'s own `wallPct()` recipe over
 * the route's `strike_totals` instead of calling `gexPositioningFromHeatmap` directly, and why
 * `DEFAULT_PIN_UNIVERSE` is copied inline rather than imported from `pin-discovery.ts`).
 *
 * ONE LIVE SNAPSHOT ONLY — the PIN_TEMPORAL_STABILITY gate (2+ agreeing snapshots) is explicitly
 * NOT measured here (disclosed above and again in the summary). This tool answers the layer BEFORE
 * that one: does `evaluatePinRegime` even fire at all, right now, across a real universe, and if it
 * does on SPX/NDX, does `condorSellRegime` also clear on top of it. A single-snapshot PASS is
 * necessary but not sufficient for a real commit; a single-snapshot FAIL is sufficient on its own
 * (the temporal gate can only narrow further, never rescue a failed snapshot).
 *
 * COMPANION EVIDENCE (CloudWatch, `/ecs/blackout-production`, 14-day window, 2026-09-17): grepping
 * for `[zerodte-pin]` shows the source is NOT silently dead — it built 221 real pin setups over 14
 * days ("built N pin setup(s) from 20 evaluated name(s)": 203 x1, 16 x2, 2 x3) alongside 1049
 * "no clean pin regime" skips and 2919+1809 before/after-window skips. Yet 0 of those ever appear
 * in the 90-day COMMITTED ledger (neither PIN-origin directional NOR condor). That gap — candidates
 * built but never committed — points downstream of discovery, at the SAME hard-gate/Cortex funnel
 * `zerodte-gate-compound-funnel.mjs` already measured a near-0% joint pass rate for on FLOW-origin
 * setups (that tool's own header discloses PIN/BREAKOUT origins as NOT measured by it) — not at a
 * PIN/condor-specific bug. See INTENTIONAL-DESIGN.md's write-up for the full account and the
 * natural follow-up (extend the compound-funnel measurement to PIN-origin setups specifically).
 *
 * Never gates anything. Read-only. Flags: --tickers=A,B,... (default: the real DEFAULT_PIN_UNIVERSE,
 * mirrored from pin-discovery.ts) --json
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

function parseArgs(argv) {
  const out = { tickers: null, json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--tickers=")) out.tickers = a.slice("--tickers=".length).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Real, imported production functions -- never reimplemented. These modules carry no
  // server-only/DB import, so they resolve via a bare @/ specifier under `node --import tsx`.
  const { evaluatePinRegime, pinSourceEnabled } = await import("@/lib/zerodte/pin-source.ts");
  const { condorSellRegime, condorEligibleTicker, condorFlagEnabled } = await import("@/lib/zerodte/condor.ts");
  const { computeGexWalls, mapFromStrikeTotalsRecord } = await import("@/lib/providers/gex-wall-levels.ts");

  // Mirrored (not imported) from pin-discovery.ts's own DEFAULT_PIN_UNIVERSE -- that module's
  // top-level import of gexPositioningFromHeatmap pulls in a `server-only`-guarded transitive
  // chain that throws outside a Next.js server context, so it cannot be imported into a plain
  // script even for just this one constant. Keep in lockstep with pin-discovery.ts if that list
  // changes.
  const DEFAULT_PIN_UNIVERSE = [
    "SPX", "NDX", "SPY", "QQQ", "IWM", "DIA",
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "AMD",
    "NFLX", "CRM", "AVGO", "COST", "LLY", "JPM", "V", "MA",
    "UNH", "WMT", "PG", "JNJ", "HD", "ADBE", "INTC", "MU",
  ];

  const tickers = args.tickers ?? [...DEFAULT_PIN_UNIVERSE];

  const rows = [];
  try {
    for (const ticker of tickers) {
      const res = await fetchAuditJson(
        "https://blackouttrades.com",
        `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`
      );
      if (!res?.ok || !res.json) {
        rows.push({ ticker, stage: "fetch_failed", detail: `status ${res?.status}` });
        continue;
      }
      const j = res.json;
      const spot = typeof j.spot === "number" ? j.spot : null;
      const gex = j.gex ?? {};
      const callWall = typeof gex.call_wall === "number" ? gex.call_wall : null;
      const putWall = typeof gex.put_wall === "number" ? gex.put_wall : null;
      const gammaPosture = gex.regime?.posture === "long" || gex.regime?.posture === "short" ? gex.regime.posture : null;

      if (!(spot > 0)) {
        rows.push({ ticker, stage: "no_spot", detail: "heatmap carried no usable spot" });
        continue;
      }
      const strikeTotals = gex.strike_totals && typeof gex.strike_totals === "object" ? gex.strike_totals : {};
      const walls = computeGexWalls(mapFromStrikeTotalsRecord(strikeTotals), { spot });
      const callWallPct = callWall != null ? walls.callWalls.find((w) => w.strike === callWall)?.pct ?? null : null;
      const putWallPct = putWall != null ? walls.putWalls.find((w) => w.strike === putWall)?.pct ?? null : null;

      const regime = evaluatePinRegime({ spot, callWall, putWall, callWallPct, putWallPct, gammaPosture });
      if (!regime) {
        rows.push({
          ticker,
          stage: "no_pin",
          detail: `posture=${gammaPosture ?? "?"} callWall=${callWall ?? "?"} putWall=${putWall ?? "?"} callWallPct=${callWallPct ?? "?"} putWallPct=${putWallPct ?? "?"}`,
        });
        continue;
      }

      const isCondorEligible = condorEligibleTicker(ticker);
      if (!isCondorEligible) {
        rows.push({ ticker, stage: "pin_ok_not_condor_eligible", detail: `${ticker} is not SPX/NDX -- stays the directional fade path`, regime });
        continue;
      }
      const sell = condorSellRegime(regime);
      rows.push({
        ticker,
        stage: sell.sell ? "condor_regime_qualified" : "pin_ok_condor_regime_rejected",
        detail: sell.reason,
        regime,
      });
    }
  } finally {
    await releaseAuditClerkSession();
  }

  const pinOk = rows.filter((r) => r.stage.startsWith("pin_ok") || r.stage === "condor_regime_qualified");
  const condorEligible = rows.filter((r) => r.stage === "pin_ok_condor_regime_rejected" || r.stage === "condor_regime_qualified");
  const condorQualified = rows.filter((r) => r.stage === "condor_regime_qualified");

  const results = {
    universe_size: tickers.length,
    flags: { condorFlagEnabled: condorFlagEnabled(), pinSourceEnabled: pinSourceEnabled() },
    stage_1_clean_pin: { n: pinOk.length, of: rows.length },
    stage_2_condor_eligible_root_with_pin: { n: condorEligible.length },
    stage_3_condor_regime_qualified: { n: condorQualified.length, tickers: condorQualified.map((r) => r.ticker) },
    rows,
  };

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nPIN -> CONDOR funnel — LIVE single snapshot, ${tickers.length} tickers`);
  console.log(`Flags (read in THIS process -- confirmed to match production's actual env, no override set for either): condorFlagEnabled=${results.flags.condorFlagEnabled} pinSourceEnabled=${results.flags.pinSourceEnabled}\n`);
  for (const r of rows) {
    console.log(`  ${r.ticker.padEnd(6)} ${r.stage.padEnd(28)} ${r.detail ?? ""}`);
  }
  console.log(`\nStage 1 -- clean PIN (evaluatePinRegime passes): ${results.stage_1_clean_pin.n}/${results.stage_1_clean_pin.of}`);
  console.log(`Stage 2 -- of those, on a condor-eligible root (SPX/NDX): ${results.stage_2_condor_eligible_root_with_pin.n}`);
  console.log(`Stage 3 -- of those, condorSellRegime QUALIFIES: ${results.stage_3_condor_regime_qualified.n}${results.stage_3_condor_regime_qualified.tickers.length ? " (" + results.stage_3_condor_regime_qualified.tickers.join(", ") + ")" : ""}`);
  console.log(
    "\nNOT MEASURED: PIN_TEMPORAL_STABILITY (2+ agreeing snapshots ~5min apart, confirmed ON in production) " +
      "-- this tool is a single snapshot, which the temporal gate can only narrow further, never rescue. " +
      "Also not measured: the live chain's 4-leg listing/liquidity check (buildCondorFromChain/priceCondorLegs) " +
      "that runs AFTER condorSellRegime and can still fall through to the directional fade, and the hard-gate/Cortex " +
      "stack a PIN-origin candidate must ALSO clear after merge (see this script's own header for the CloudWatch " +
      "evidence pointing there as the more likely real bottleneck)."
  );
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exitCode = 1;
});

// 0DTE Command scanner — the ALWAYS-ON half of the board. The same pipeline runs
// two ways: the grid-warm cron calls warmZeroDteBoard() every ~2 min through RTH
// (so the system hunts all session even when nobody is looking), and the board
// route calls scanZeroDteBoard() on member polls (collapsed to one build per 5s).
// Every qualifying find is upserted into the zerodte_setup_log ledger and graded
// against the session close afterwards — the board's discovery record is measured,
// not asserted.
//
// Mandate (product rule): this surface finds NEW plays. Index products (SPY/SPX/
// NDX/QQQ…) ARE eligible — the dominance gate naturally admits them only when
// their normally two-sided tape genuinely leans. Night Hawk edition tickers are
// NOT excluded (2026-07-28 remodel — NH is next-day digest, not same-session).
// 0DTE discipline: new directional plays 10:00–15:30 ET; hard exit 15:50 ET.

import {
  dbConfigured,
  fetchLatestNighthawkEdition,
  fetchOpenSpxPlay,
  fetchRecentFlows,
  fetchUngradedZeroDteRows,
  fetchZeroDteSetupLog,
  gradeZeroDteSetupRow,
  insertAlertAuditLog,
  stampZeroDteExecutableGrade,
  updateZeroDteLiveState,
  updateZeroDtePlanOutcome,
  upsertZeroDteSetupLog,
  commitFreshZeroDteRowsAtomic,
  type ZeroDteSetupLogRow,
  type ZeroDteSetupLogUpsert,
} from "@/lib/db";
import { fetchNighthawkEchoForTickers } from "@/lib/bie/ecosystem-context";
import { MIN_PREMIUM_NEAR_DATED } from "@/lib/flow-persist";
import {
  accumulationSignalsFromFlow,
  attachFlowAccumulation,
  MULTI_DAY_FLOW_HOURS,
  MULTI_DAY_FLOW_LIMIT,
  MULTI_DAY_MIN_PREMIUM,
} from "./flow-accumulation-context";
import { attachConfluence } from "./confluence";
import { breakoutSourceEnabled, mergeDiscoveryOrigins } from "./breakout-source";
import {
  applyFlowCorroboration,
  breakoutOnlyTickers,
  deriveFlowCorroborationSetups,
  enrichCorroboratingFlowSetups,
  flowCorroborationEnabled,
  FLOW_CORROBORATION_LIMIT,
  FLOW_CORROBORATION_MAX_TICKERS,
  FLOW_CORROBORATION_SINCE_HOURS,
  mapFlowRowsForCorroboration,
} from "./flow-corroboration";
import { deriveWhyNow } from "./why-now";
import { pinSourceEnabled, mergePinOrigins } from "./pin-source";
import {
  initialDiscoveryHealth,
  laneStatusFromBreakoutOutcome,
  type DiscoveryHealth,
} from "./discovery-health";
import { pinWindowStatus } from "./pin-window";
import { LEVERAGED_ETP_SET } from "@/features/nighthawk/lib/constants";
import { createDossierBuildCache, fetchTickerDossier } from "@/features/nighthawk/lib/dossier";
import { etNowParts, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { macroEventsOnDateLive } from "@/lib/providers/macro-events";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { buildOcc } from "@/lib/ws/options-socket";
import { requireHealthySourceEnabled } from "@/lib/ws/source-health";
import { getFlowSourceHealthState } from "@/lib/ws/uw-socket";
import { withServerCache } from "@/lib/server-cache";
import { recordZeroDteScanTick } from "@/lib/play-engine-heartbeat";
import {
  buildZeroDteAuditRow,
  computeLedgerGrade,
  deriveZeroDteSetups,
  enrichSetup,
  INDEX_OPTION_ROOTS,
  isSameDayHorizon,
  matchEarnings,
  polygonSpotTicker,
  refreshUnderlyingFromLiveSpot,
  buildOriginMaps,
  MERGE_POLICY_VERSION,
  summarizeDiscoveryRailMix,
  type EarningsFlag,
  type EnrichedZeroDteSetup,
  type NewsHeat,
  type SetupDossierView,
  type ZeroDteGateRejection,
} from "./board";
import { gradeCondorFromBars } from "./condor";
import { buildZeroDteEntryContext, fetchZeroDteSessionContext } from "./entry-context";
import { buildMarketState, weightedScoreForMerge, type MarketStateSnapshot } from "./market-state-engine";
import {
  calibrationPriorBlendFactor,
  loadShadowRailPriors,
} from "./calibration-rail-priors";
// WS-14/15 observability (additive, best-effort — never a decision input). See
// latency-telemetry.ts's module doc: it records spans/durations and freezes a per-commit
// input-age manifest; every recorder swallows its own errors so it can't affect the scan.
import {
  buildInputAgeManifest,
  recordCommitLatency,
  recordCommittedRows,
  recordExecutionTaxBps,
  recordGradeVsAsManagedDeltaBps,
  recordScanDuration,
  recordScanSpans,
  recordUngradeable,
} from "./latency-telemetry";
import { buildSetupFeatureVector } from "./feature-vector";
import {
  buildStrategyManifest,
  strategyConfigHash,
  buildResolvedExitPolicy,
  exitPolicyGraderParams,
} from "./strategy-version";
import { evaluateLedgerRowExit, resolveExitModeForTier, readFrozenExitPolicy } from "./exit-sync";
import { cortexEntryContextFor, cortexGateBlocks, evaluateCortexForCommit } from "./cortex-gate";
import { applyCortexVetoDwell } from "./cortex-veto-dwell";
import { persistZeroDteRejections } from "./rejections";
import { attachThesisFirstShadow, thesisFirstEntryContext } from "./thesis/scan-shadow";
import { thesisFirstEnv } from "./thesis/types";
import { attachThesisContractPlans } from "./thesis/contract-attach";
import { thesisBlocksToGateBlocks } from "./thesis/live-pipeline";
import {
  persistDiscoveryCommitEvents,
  persistDiscoveryDetectedEvents,
  persistDiscoveryGateBlockedEvents,
} from "./discovery-events-persist";
import {
  evaluateZeroDteGates,
  freshCommitBlockedByPlan,
  gateRejectionFor,
  planQualityGateBlocks,
  refreshPlanQualityGateBlocks,
  refreshMoneynessGateBlocks,
  refreshGovernorPremiumBudgetBlocks,
  recentNighthawkTake,
} from "./gates";
import { buildRegimePlaneSnapshot, inferRegimeGexQuality } from "./regime-plane";
import {
  deriveGovernorFromLedger,
  evaluateZeroDteGovernor,
  loadRecordedGovernorStops,
  mergeGovernorStops,
  recordGovernorStops,
  freezeConcentrationState,
  aggregatePremiumAtRisk,
  countShortGammaOpen,
  type GovernorSnapshot,
  type GovernorOpenPlan,
} from "./governor";
import {
  computeIntradayRead,
  intradayScoreAdjust,
  marketAlignAdjust,
  marketBias,
  timeOfDayFactor,
  type IntradayRead,
  type MarketBias,
} from "./intraday";
import {
  buildContractPlan,
  derivePlayStatus,
  gradePlanExecutableFromBars,
  gradePlanFromBars,
  NEW_PLAY_CUTOFF_ET_MINUTES,
  reconstructTrimScaleExecutableFromBars,
  resolveLedgerEntryPremium,
  type PlanBar,
  type TrimScaleSpec,
} from "./plan";
import {
  executionTaxBps,
  latchPremiumBounds,
  zeroDteHalfSpreadFrac,
  ZERODTE_DEFAULT_HALF_SPREAD_FRAC,
} from "./marks-math";
// WS-11 — the grade path measures grade_vs_asmanaged_delta by comparing the OFFICIAL executable
// grade to the record's AS-MANAGED number on the SAME row (both read from record.ts, the single
// source of truth), so a reconciliation regression surfaces as a non-zero telemetry percentile.
import { asManagedPnlPct, officialPlanPnlPct } from "./record";

/** Leveraged/inverse wrappers and vol ETPs stay out (not directional single plays);
 *  index products (SPY/SPX/NDX/QQQ…) are eligible per product direction. Night Hawk
 *  edition tickers are listed as covered_elsewhere but remain eligible for 0DTE. */
const STATIC_EXCLUDES = new Set<string>([...LEVERAGED_ETP_SET, "VIX", "UVXY"]);

/** Top finds get the full Night Hawk dossier — aligned with FLOW maxSetups (48) so ranks
 *  13–48 are no longer Cortex-starved. Batched (ENRICH_BATCH_SIZE) to avoid a 48-wide
 *  UW fan-out thundering herd on the cron warm path. */
export const ENRICH_TOP_N = 48;
const ENRICH_BATCH_SIZE = 8;
const DOSSIER_CACHE_TTL_MS = 10 * 60 * 1000;
/** How long a caller waits for a COLD dossier before serving the un-enriched setup.
 *  The cache loader keeps running after we stop waiting, so the next scan (~2 min)
 *  or poll (~15s) gets the enriched row instantly — the board "heats up". */
const ENRICH_WAIT_MS = 4_000;

import {
  resolveFirewallEarnings,
  resolveFirewallMacro,
  resolveFirewallNumeric,
} from "./firewall-fallback";

/** Await `p` for at most `ms`, else null — without cancelling `p` (it continues in
 *  the background and populates the server cache). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

export type ZeroDteScanResult = {
  setups: EnrichedZeroDteSetup[];
  /** Tickers withheld because Night Hawk already published them (latest edition). */
  nighthawk_covered: string[];
  /** False when the tape fetch this scan depends on failed and silently degraded to an
   *  empty read — distinguishes "genuinely quiet tape" from "the scan couldn't see the
   *  tape at all" so the board's freshness badge can tell members apart instead of
   *  always reading "Live". Never gates scoring/output, purely a provenance signal. */
  upstream_ok: boolean;
  /** Every candidate ticker this cycle that failed at least one of deriveZeroDteSetups'
   *  4 gates (task #147) — the near-miss half of this scan's output. The board route
   *  ignores this field entirely (member polls never persist); only warmZeroDteBoard
   *  forwards it to persistZeroDteRejections, on the same cron cadence committed
   *  setups already persist on. */
  rejections: ZeroDteGateRejection[];
  /** Market State Engine snapshot for this scan (Phase 1+) — used by discovery-event persist on cron. */
  market_state: MarketStateSnapshot;
  /** Per-lane provenance for the two whole-market discovery origins (BREAKOUT / PIN). Both are
   *  best-effort and degrade to zero contribution on a fail-closed snapshot or a throw; without
   *  this, a roster that collapsed because a lane never ran is byte-identical to a quiet session.
   *  Purely a provenance signal — it never gates scoring and never adds a candidate. */
  discovery_health: DiscoveryHealth;
};

/**
 * The discovery pipeline: HELIX tape → per-ticker aggregation with evidence gates →
 * Night Hawk dedupe → full-dossier enrichment for the top finds. Regime context is
 * intentionally null: the intraday board wants the raw factor read, not the evening
 * regime multiplier.
 */
export async function scanZeroDteBoard(flags?: {
  earnings?: Map<string, EarningsFlag>;
  news?: Map<string, NewsHeat>;
}): Promise<ZeroDteScanResult> {
  const today = todayEt();
  const sessionCtx = await fetchZeroDteSessionContext().catch(() => null);
  const shadowPriors = await loadShadowRailPriors().catch(() => null);
  const calBlend = await calibrationPriorBlendFactor();
  const marketState: MarketStateSnapshot = buildMarketState({
    regime: sessionCtx?.regime ?? null,
    sessionDate: today,
    shadowCalibration:
      shadowPriors && calBlend > 0
        ? {
            rail_weights: shadowPriors.rail_weights,
            confidence: shadowPriors.confidence,
            blend: calBlend,
          }
        : null,
  });
  // WS-14 span capture (observability only): stamp the wall-clock at each pipeline hop the
  // scan actually knows. These never gate anything — they feed recordScanSpans below.
  const scanStartedAt = Date.now();
  let upstreamOk = true;
  const [flows, nhEdition, multiDayFlows] = await Promise.all([
    // max_dte: 1 is LOAD-BEARING — it scopes the premium ranking to 0-1DTE prints in
    // SQL. Without it the top-400 spans ALL expiries and heavy-day whale prints crowd
    // every 0DTE print out of the scan's input (live-reproduced: $3.1M AAPL stack → 0 setups).
    // FINDINGS 2026-08-04: min_premium matches the ingestion-side near-dated floor (was a flat
    // 100_000, redundant-then-stricter than the old $200k ingestion floor — but now that
    // ingestion admits 0-1DTE prints down to MIN_PREMIUM_NEAR_DATED, this query must not
    // re-exclude them, or the lower ingestion floor accomplishes nothing for FLOW discovery).
    fetchRecentFlows({ since_hours: 7, min_premium: MIN_PREMIUM_NEAR_DATED, order: "premium", limit: 500, max_dte: 1 }).catch(
      () => {
        upstreamOk = false;
        return [];
      }
    ),
    fetchLatestNighthawkEdition().catch(() => null),
    // MULTI-DAY MEMORY (PR: accumulation context): a separate WIDE window — several days, ALL
    // expiries (no max_dte) — feeds the multi-day flow-accumulation engine so each setup knows
    // whether today's 0DTE direction is confirmed by stacked positioning over the week. Best-effort:
    // a failure here degrades to "no memory" (null context), never breaks the intraday scan.
    fetchRecentFlows({
      since_hours: MULTI_DAY_FLOW_HOURS,
      min_premium: MULTI_DAY_MIN_PREMIUM,
      order: "premium",
      limit: MULTI_DAY_FLOW_LIMIT,
    }).catch(() => []),
  ]);

  const nighthawkCovered = Array.from(
    new Set(
      (Array.isArray(nhEdition?.plays) ? nhEdition!.plays : [])
        .map((p) => String((p as Record<string, unknown>)?.ticker ?? "").toUpperCase())
        .filter(Boolean)
    )
  );
  // NH edition tickers are surfaced as covered_elsewhere but NOT excluded from discovery
  // (2026-07-28): excluding them removed the overnight playbook's best names from 0DTE.
  const excludes = new Set<string>([...STATIC_EXCLUDES]);

  // Always collected (cheap — a handful of array pushes per candidate ticker);
  // whether it's ever WRITTEN anywhere is a separate decision made by the caller
  // (only warmZeroDteBoard forwards it to persistZeroDteRejections below).
  const rejections: ZeroDteGateRejection[] = [];
  const rawSetups = deriveZeroDteSetups(
    flows.map((f) => ({
      ticker: f.ticker,
      premium: f.premium,
      option_type: f.option_type,
      strike: f.strike,
      expiry: f.expiry,
      dte: f.dte,
      alert_rule: f.alert_rule,
      ask_pct: f.ask_pct,
      underlying_price: f.underlying_price,
      fill_price: f.fill_price,
      open_interest: f.open_interest,
      alerted_at: f.alerted_at,
    })),
    // FLOW seat budget — raised 20→48 so the multi-rail merge isn't starved of
    // FLOW candidates while BREAKOUT/PIN fill their own seats (see GOVERNOR uncapped).
    { maxSetups: 48, excludeTickers: excludes, nowMs: Date.now(), todayYmd: today, rejections }
  );
  const candidateDerivedAt = Date.now();

  const buildCache = createDossierBuildCache();
  const extrasFor = (ticker: string) => ({
    earnings: flags?.earnings?.get(ticker) ?? null,
    news_hot: flags?.news?.get(ticker) ?? null,
  });
  const enrichCap = Math.min(ENRICH_TOP_N, rawSetups.length);
  const setups: EnrichedZeroDteSetup[] = [];
  // Ranks beyond the cap: no dossier (batch halt/earnings still cover G-11).
  for (let i = enrichCap; i < rawSetups.length; i++) {
    const setup = rawSetups[i]!;
    setups[i] = await enrichSetup(setup, null, extrasFor(setup.ticker));
  }
  // Top ranks: dossier in bounded parallel batches so UW budget stays predictable.
  for (let start = 0; start < enrichCap; start += ENRICH_BATCH_SIZE) {
    const end = Math.min(start + ENRICH_BATCH_SIZE, enrichCap);
    const batch = await Promise.all(
      rawSetups.slice(start, end).map(async (setup) => {
        const dossier = await within(
          withServerCache<SetupDossierView>(
            `zerodte:dossier:${setup.ticker}:${today}`,
            DOSSIER_CACHE_TTL_MS,
            () => fetchTickerDossier(setup.ticker, null, buildCache)
          ),
          ENRICH_WAIT_MS
        );
        return enrichSetup(setup, dossier, extrasFor(setup.ticker));
      })
    );
    for (let j = 0; j < batch.length; j++) {
      setups[start + j] = batch[j]!;
    }
  }

  // ── BREAKOUT discovery origin (Phase 3a, §1a) — the SECOND, INDEPENDENT discovery source ──
  // Flag-gated via ZERODTE_WHOLE_MARKET + ZERODTE_SRC_BREAKOUT (default ON; set to "0" to disable). When enabled, the
  // whole-market breakout screen emits its own candidates carrying discovery_origin ["BREAKOUT"];
  // they merge with the flow candidates BY TICKER preserving origin as a SET (a shared ticker →
  // ["FLOW","BREAKOUT"]), never a collapsed pool. Merge policy v2: same-direction corroboration
  // boosts score; opposing directions are evidence-weighted (higher score owns the slot).
  // Merged BEFORE the accumulation overlay + contract-attach + gate/Cortex stack so every breakout
  // candidate runs the SAME mandatory contract-attach + shared hard gates + Cortex as a flow one.
  // The IO orchestration is dynamic-imported so the flow-only board never loads the whole-market
  // provider graph; any failure degrades to the flow-only board (best-effort). The FLOW evidence
  // gates (SETUP_MIN_GROSS / SETUP_MIN_AGGR_SHARE / dominance / moneyness) live INSIDE
  // deriveZeroDteSetups and structurally never touch a breakout setup — it enters the pipeline here,
  // AFTER that function, and is validated instead by its breakout score + the shared hard-gate stack.
  const discoveryHealth: DiscoveryHealth = initialDiscoveryHealth();
  if (breakoutSourceEnabled()) {
    try {
      const { hour, minute } = etNowParts();
      const { discoverBreakoutSetups } = await import("./breakout-discovery");
      // WS-19: outcome is discriminated — `data_unavailable` (stale/unverifiable grouped snapshot)
      // fails CLOSED to an empty setups list, so a stale snapshot never adds candidates and never
      // reads as a genuine "no breakouts". We consume setups directly; a non-`ok` status just means
      // zero breakout setups this cycle (the flow board is untouched).
      const breakoutOutcome = await discoverBreakoutSetups({
        today,
        nowEtMinutes: hour * 60 + minute,
        excludeTickers: excludes,
      });
      const breakoutSetups = breakoutOutcome.setups;
      discoveryHealth.BREAKOUT = {
        status: laneStatusFromBreakoutOutcome(breakoutOutcome.status),
        setups: breakoutSetups.length,
        ...("reason" in breakoutOutcome && breakoutOutcome.reason ? { reason: breakoutOutcome.reason } : {}),
      };
      if (breakoutSetups.length > 0) {
        mergeDiscoveryOrigins(setups, breakoutSetups);
        // Prefer true 0DTE over 1DTE, then score — concurrency budget goes to best same-day finds.
        setups.sort((a, b) => {
          const ha = a.contract_horizon === "ZERO_DTE" ? 1 : 0;
          const hb = b.contract_horizon === "ZERO_DTE" ? 1 : 0;
          if (ha !== hb) return hb - ha;
          return b.score - a.score;
        });
      }

      // Targeted FLOW corroboration: global premium-ranked fetch starves mid-cap BREAKOUT
      // names of a FLOW merge. Probe each BREAKOUT-only ticker's own near-dated tape.
      if (flowCorroborationEnabled()) {
        try {
          const targets = breakoutOnlyTickers(setups).slice(0, FLOW_CORROBORATION_MAX_TICKERS);
          if (targets.length > 0) {
            const corroRows = (
              await Promise.all(
                targets.map((ticker) =>
                  fetchRecentFlows({
                    ticker,
                    since_hours: FLOW_CORROBORATION_SINCE_HOURS,
                    min_premium: MIN_PREMIUM_NEAR_DATED,
                    max_dte: 1,
                    limit: FLOW_CORROBORATION_LIMIT,
                  }).catch(() => [])
                )
              )
            ).flat();
            if (corroRows.length > 0) {
              const rawCorro = deriveFlowCorroborationSetups(mapFlowRowsForCorroboration(corroRows), {
                todayYmd: today,
                nowMs: Date.now(),
                excludeTickers: excludes,
              });
              const extrasByTicker = new Map(
                rawCorro.map((s) => [
                  s.ticker,
                  {
                    earnings: flags?.earnings?.get(s.ticker) ?? null,
                    news_hot: flags?.news?.get(s.ticker) ?? null,
                  },
                ])
              );
              const enrichedCorro = enrichCorroboratingFlowSetups(rawCorro, extrasByTicker);
              const nMerged = applyFlowCorroboration(setups, enrichedCorro);
              if (nMerged > 0) {
                console.info(`[zerodte-flow-corroboration] merged FLOW onto ${nMerged}/${targets.length} BREAKOUT-only tickers`);
              }
            }
          }
        } catch (err) {
          console.warn("[zerodte-flow-corroboration] targeted flow fetch failed — breakout-only board unchanged:", err);
        }
      }
    } catch (err) {
      // The board is deliberately unaffected (flow-only this cycle) — but the payload now SAYS so,
      // instead of serving a 75%-smaller roster that reads as a quiet market.
      discoveryHealth.BREAKOUT = { status: "failed", setups: 0, reason: "threw" };
      console.warn("[zerodte-breakout] discovery failed — flow-only board this cycle:", err);
    }
  }

  // ── PIN discovery origin (Phase 3b, §1a) — the THIRD, INDEPENDENT discovery source ──
  // Flag-gated via ZERODTE_WHOLE_MARKET + ZERODTE_SRC_PIN (default ON; set to "0" to disable). When enabled, a liquid-universe
  // screen emits mean-reversion candidates — names pinned between dominant dealer GEX walls in a
  // long-gamma tape — as directional-FADE setups carrying discovery_origin ["PIN"]. They merge BY
  // TICKER preserving origin as a SET (a shared ticker → e.g. ["FLOW","PIN"]), never a collapsed
  // pool. Merge policy v2 (same as breakout). Merged here, AFTER deriveZeroDteSetups, so the FLOW
  // evidence gates structurally never see them; each pin candidate runs the SAME mandatory
  // contract-attach + shared hard gates + Cortex as a flow one. The fade direction is only ever
  // emitted in a genuine long-gamma RANGE, so G-1 (tape-alignment) passes cleanly in the flat-tape
  // case and correctly culls a fade that fights a trending broad tape (see pin-source.ts's G-1 note).
  // IO is dynamic-imported so the flow-only board never loads the whole-universe GEX graph; any
  // failure degrades to the flow board (best-effort).
  if (pinSourceEnabled()) {
    try {
      const { hour, minute } = etNowParts();
      const { discoverPinSetups } = await import("./pin-discovery");
      const pinSetups = await discoverPinSetups({
        today,
        nowEtMinutes: hour * 60 + minute,
        excludeTickers: excludes,
      });
      // discoverPinSetups returns a bare array, so "ran and found nothing" and "was outside its own
      // window" are the same [] — pinWindowStatus separates them. Reporting a zero as `ok` at 8am
      // would be a fabricated market read, which is the exact confusion this field exists to end.
      discoveryHealth.PIN =
        pinWindowStatus(hour * 60 + minute) === "off_hours"
          ? { status: "off_hours", setups: 0 }
          : { status: "ok", setups: pinSetups.length };
      if (pinSetups.length > 0) {
        mergePinOrigins(setups, pinSetups);
        // Prefer true 0DTE over 1DTE when scores tie — the board is a 0DTE product.
        setups.sort((a, b) => {
          const ha = a.contract_horizon === "ZERO_DTE" ? 1 : 0;
          const hb = b.contract_horizon === "ZERO_DTE" ? 1 : 0;
          if (ha !== hb) return hb - ha;
          return b.score - a.score;
        });
      }
    } catch (err) {
      discoveryHealth.PIN = { status: "failed", setups: 0, reason: "threw" };
      console.warn("[zerodte-pin] discovery failed — flow-only board this cycle:", err);
    }
  }

  // Market State Engine v0 — regime-adaptive rail priors at merge rank (shadow-safe: re-sorts only).
  if (marketState.confidence > 0 && process.env.ZERODTE_MARKET_STATE_ENABLED !== "0") {
    setups.sort((a, b) => {
      const wb = weightedScoreForMerge(b.score, b.discovery_origin, marketState);
      const wa = weightedScoreForMerge(a.score, a.discovery_origin, marketState);
      if (wb !== wa) return wb - wa;
      const ha = a.contract_horizon === "ZERO_DTE" ? 1 : 0;
      const hb = b.contract_horizon === "ZERO_DTE" ? 1 : 0;
      if (ha !== hb) return hb - ha;
      return b.score - a.score;
    });
    console.info(
      `[zerodte-scan] market_state structure=${marketState.regime_structure ?? "unknown"} ` +
        `conf=${marketState.confidence} FLOW×${marketState.rail_weights.FLOW} ` +
        `BREAKOUT×${marketState.rail_weights.BREAKOUT} PIN×${marketState.rail_weights.PIN}`
    );
  }

  // Observability: surface the post-merge rail mix every cycle so a FLOW-only board is diagnosable
  // from logs (off-hours BREAKOUT/PIN skips vs. merge swallowing every non-flow name).
  {
    const mix = summarizeDiscoveryRailMix(setups);
    console.info(
      `[zerodte-scan] discovery rail mix total=${mix.total} FLOW=${mix.FLOW} BREAKOUT=${mix.BREAKOUT} ` +
        `PIN=${mix.PIN} multi=${mix.multi} merge_policy=${MERGE_POLICY_VERSION}`
    );
  }

  // Multi-day flow-accumulation memory: attach whether each setup's direction is confirmed by
  // stacked positioning over the week (+ the magnet strike). Evidence only — calibration-first, does
  // not gate the board (see flow-accumulation-context.ts). Pure + best-effort: an empty multi-day
  // window just leaves every context null.
  attachFlowAccumulation(setups, accumulationSignalsFromFlow(multiDayFlows, Date.now()));

  const thesisEnv = thesisFirstEnv();
  const thesisLive = thesisEnv.enabled;
  if (!thesisLive) {
    await attachContractPlans(setups);
  }
  const chainReceivedAt = Date.now();
  const tape = await attachIntradayEdge(setups);

  // Confluence read — how many of {post-open timing, price vs VWAP, market alignment} agree with each
  // setup's direction. Runs AFTER the intraday-edge pass (which populates intraday + market_aligned)
  // and BEFORE the gate stack, because G-12 now reads its `confirmations` count (Phase 1, 2026-07-24):
  // the VWAP+market agreement is a real commit input, not just a card badge. The tier/score stay
  // calibration-first display; only the confirmation FLOOR gates. Attached to ALL setups so the
  // committed row carries a PRESENT read (0/1/2), closing the live "no_read on 96/98" hole.
  const nowEt = etNowParts();
  const nowEtMinutes = nowEt.hour * 60 + nowEt.minute;
  attachConfluence(setups, nowEtMinutes);

  // Thesis-first: cache-backed evidence bundle → rails; shadow or live.
  if (thesisEnv.enabled || thesisEnv.shadow) {
    const { fetchThesisEvidenceForTickers } = await import("./thesis/evidence-bundle");
    const { buildHelixExtrasByTicker } = await import("./thesis/helix-tape-extras");
    const { mergeLegacyBridgeExtras } = await import("./thesis/evidence-bundle-map");
    const tickers = [...setups]
      .sort((a, b) => b.score - a.score)
      .map((s) => s.ticker.toUpperCase());
    const thesisExtras = await fetchThesisEvidenceForTickers(tickers, {
      maxTickers: tickers.length,
    });
    const helixExtras = buildHelixExtrasByTicker(
      flows.map((f) => ({
        ticker: f.ticker,
        premium: f.premium,
        option_type: f.option_type,
        ask_pct: f.ask_pct,
        alerted_at: f.alerted_at,
      }))
    );
    for (const t of tickers) {
      thesisExtras[t] = mergeLegacyBridgeExtras(thesisExtras[t] ?? {}, helixExtras[t] ?? {});
    }
    attachThesisFirstShadow(setups, nowEtMinutes, thesisExtras);
  }

  // Hard-gate verdicts — Cortex runs inside on gate survivors.
  const { governorPremiumAtRisk } = await attachGateVerdicts(setups, tape.bias, tape.biasAsOfMs, nowEtMinutes);

  // Live thesis-first: contract engine picks expression AFTER thesis + gates + Cortex.
  if (thesisLive) {
    await attachThesisContractPlans(setups);
    await attachContractPlans(setups);
    for (const s of setups) {
      if (s.gate) {
        s.gate = refreshPlanQualityGateBlocks(s.gate, s.plan ?? null);
        // Moneyness re-check (P0 fix, 2026-08-27): attachContractPlans (just above) is what runs
        // refreshUnderlyingFromLiveSpot in this (thesis-first) pipeline, i.e. AFTER
        // attachGateVerdicts already evaluated the moneyness caps against the PRE-refresh
        // otm_pct — the exact "deferred, never reconciled" shape refreshPlanQualityGateBlocks
        // exists to fix for G-8/G-9. Re-apply the same two caps against the now-refreshed
        // s.otm_pct so a candidate whose live moneyness drifted past a cap during this pass
        // still gets caught (mirrors refreshGovernorPremiumBudgetBlocks below).
        s.gate = refreshMoneynessGateBlocks(s.gate, s.otm_pct ?? null, s.play_type === "CONDOR");
        // G-5 premium budget was computed with plan=null (entry_premium 0) above, same
        // "deferred, never reconciled" shape as G-8/G-9 — see refreshGovernorPremiumBudgetBlocks.
        s.gate = refreshGovernorPremiumBudgetBlocks(
          s.gate,
          s.plan?.entry_max ?? s.plan?.mark ?? null,
          governorPremiumAtRisk
        );
      }
    }
  }
  const gatesCompletedAt = Date.now();

  // WS-14/15 (observability only, best-effort — recorders swallow their own errors): record
  // this pass's stage spans + overall wall-clock. cortex_completed_at ≡ gatesCompletedAt (the
  // Cortex runs INSIDE attachGateVerdicts on gate survivors). committed_at/board_visible_at are
  // honestly null here — the commit happens in persistZeroDteScan and the board render in
  // zerodte-service, neither of which this function can timestamp.
  recordScanSpans({
    scan_started_at: scanStartedAt,
    candidate_derived_at: candidateDerivedAt,
    chain_received_at: chainReceivedAt,
    gates_completed_at: gatesCompletedAt,
    cortex_completed_at: gatesCompletedAt,
    committed_at: null,
    board_visible_at: null,
  });
  recordScanDuration(gatesCompletedAt - scanStartedAt);

  return {
    setups,
    nighthawk_covered: nighthawkCovered,
    upstream_ok: upstreamOk,
    rejections,
    market_state: marketState,
    discovery_health: discoveryHealth,
  };
}

/** Cached (3-min) intraday read from a name's own minute bars. */
async function intradayReadFor(ticker: string, today: string): Promise<IntradayRead | null> {
  return within(
    withServerCache<IntradayRead>(`zerodte:intraday:${ticker}:${today}`, 3 * 60 * 1000, async () => {
      // Index roots (SPXW/SPX/NDX…) only price under Polygon's I: namespace —
      // unmapped they return zero bars and the read silently degrades to nulls.
      const bars = await fetchAggBars(polygonSpotTicker(ticker), 1, "minute", today, today, "1000");
      return computeIntradayRead(
        bars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c, v: b.v }))
      );
    }),
    2_500
  );
}

/**
 * Keeps BREAKOUT's factor_breakdown reconciling to `score` exactly after attachIntradayEdge
 * adjusts the score, per breakoutScoreBreakdown's own invariant ("a breakdown whose parts do
 * not add up to the headline number is worse than none"). That adjustment used to land on
 * `score` alone, so the deck's "Why this play was picked" panel silently drifted +5/+15 off its
 * own listed factors (measured live 2026-09-02, 50/54 BREAKOUT setups). FLOW/PIN setups'
 * factor_breakdown reconciles to the SEPARATE `dossier_score` field instead (enrichSetup in
 * board.ts) and must not gain a stray entry here — gate on the breakout-only `breakout_core` key
 * so only breakoutScoreBreakdown's own shape is ever touched. `appliedDelta` must be the
 * actually-applied score delta (post 0-100 clamp), not the raw adjustment sum, so the parts
 * still total the displayed score exactly even when the clamp bites.
 */
export function applyIntradayEdgeToBreakdown(
  factorBreakdown: Record<string, number> | null,
  appliedDelta: number
): Record<string, number> | null {
  if (!factorBreakdown || appliedDelta === 0 || !("breakout_core" in factorBreakdown)) {
    return factorBreakdown;
  }
  return { ...factorBreakdown, intraday_edge: appliedDelta };
}

/** The "is it working RIGHT NOW" layer: each top play's own minute-bar read
 *  (session VWAP / opening range / 5m trend), SPY as the market tape, and the
 *  time-of-day edge window — all folded into the score, with hard intraday
 *  conflicts flagged for the A-tier gate. Best-effort: missing bars = no adjust.
 *  Returns the SPY bias (+ its freshness) so the hard-gate layer judges the SAME
 *  tape read the scores were adjusted with. */
async function attachIntradayEdge(
  setups: EnrichedZeroDteSetup[]
): Promise<{ bias: MarketBias | null; biasAsOfMs: number | null }> {
  if (setups.length === 0) return { bias: null, biasAsOfMs: null };
  const today = todayEt();
  const { hour, minute } = etNowParts();
  const nowEt = hour * 60 + minute;
  const tod = timeOfDayFactor(nowEt);

  // 9-7: compute the intraday edge for EVERY gated setup, not just the enriched top-N. Previously only the
  // top-5 got a market-align / VWAP / time-of-day score adjustment, yet attachGateVerdicts gates all of
  // them — so ranks 6-10 were gated on an UNADJUSTED score, G-10 (intraday_conflict) could never fire for
  // them, and attachConfluence always logged them "weak" (biasing the confluence calibration set). This is
  // the light per-ticker read; the heavy DOSSIER enrichment (Redis single-flight) still stays at top-N.
  const edged = setups;
  const [spyRead, ...reads] = await Promise.all([
    intradayReadFor("SPY", today),
    ...edged.map((s) => intradayReadFor(s.ticker, today)),
  ]);
  const bias = marketBias(spyRead ?? null);

  edged.forEach((s, i) => {
    const read = reads[i] ?? null;
    const adj = intradayScoreAdjust(s.direction, read);
    const align = marketAlignAdjust(s.direction, bias);
    s.intraday = read;
    s.intraday_conflict = adj.conflict;
    // Flat tape = no directional opposition → treat as aligned (same as G-4 fix in gates.ts).
    // Only null/stale bias → null (unknown, not a confirmation).
    s.market_aligned = bias == null ? null : bias === "flat" ? true : (bias === "up") === (s.direction === "long");
    s.tod_label = tod.label;
    const preScore = s.score;
    s.score = Math.max(0, Math.min(100, s.score + adj.delta + align + tod.delta));
    s.factor_breakdown = applyIntradayEdgeToBreakdown(s.factor_breakdown, s.score - preScore);
  });
  return { bias, biasAsOfMs: spyRead?.last_bar_ms ?? null };
}

/** Hard-gate verdicts (G-1.. — ./gates.ts) for every FRESH find this cycle.
 *  Already-committed ledger tickers are refreshes and are never re-gated (a printed
 *  play is managed to its exit, not retro-blocked). If the committed set can't be
 *  read, gates stay null and persistZeroDteScan fails closed on every fresh commit —
 *  the same "unreadable input is a block, not a pass" rule the evidence gates follow. */
async function attachGateVerdicts(
  setups: EnrichedZeroDteSetup[],
  bias: MarketBias | null,
  biasAsOfMs: number | null,
  nowEtMinutes: number
): Promise<{ governorPremiumAtRisk: number }> {
  if (setups.length === 0) return { governorPremiumAtRisk: 0 };
  const today = todayEt();
  const nowMs = Date.now();
  const ledgerRows = dbConfigured()
    ? await fetchZeroDteSetupLog(today).catch(() => null)
    : ([] as ZeroDteSetupLogRow[]);
  if (ledgerRows == null) return { governorPremiumAtRisk: 0 }; // gates stay null → fresh commits fail closed downstream
  const committed = new Set(ledgerRows.map((r) => r.ticker.toUpperCase()));

  // G-5 snapshot: open/stop counts from the shared Postgres ledger (authoritative),
  // stop timestamps from the Redis record (best-effort — see governor.ts's model).
  const recordedStops = await loadRecordedGovernorStops(today).catch(() => []);
  const ledgerGovernor = deriveGovernorFromLedger(ledgerRows);
  // Build the ENFORCEMENT snapshot FROM the derived one (spread), not a hand-written
  // two-field literal. The AUDIT SEV-3 realized-loss halt reads snap.realized_losers /
  // snap.session_pnl_pct; the previous literal copied ONLY open_plans + stops and dropped
  // those two, so governorLossHaltReason always saw 0/0 and the loss-halt could NEVER
  // fire in the live commit path (while the board strip showed "halted" from a separately
  // derived snapshot). Spreading ledgerGovernor carries all four fields into
  // evaluateZeroDteGovernor; we still override stops with the Redis-merged set (the only
  // field that needs the recorded timestamps for the re-entry lock).
  const governor: GovernorSnapshot = {
    ...ledgerGovernor,
    stops: mergeGovernorStops(ledgerGovernor.stops, recordedStops),
  };
  const governorPremiumAtRisk = aggregatePremiumAtRisk(ledgerRows);
  const governorShortGammaOpen = countShortGammaOpen(ledgerRows);

  // G-4/G-6 calibration context + the Phase-0 firewall inputs — all best-effort. The
  // calibration/echo reads never block (a miss degrades to an honest "unknown"/no-conflict
  // verdict); the VIX and macro reads now ALSO carry an "attempted-and-unavailable" signal
  // (null) that the gate stack fails a fresh commit closed on (G-4/G-7 firewall, gates.ts),
  // and the earnings/halt reads feed G-11 for EVERY committable candidate, not just the
  // dossier-enriched top-5.
  const freshTickers = setups.map((s) => s.ticker.toUpperCase()).filter((t) => !committed.has(t));
  const [vixDayOpen, slayerLive, nhEcho, macroRead, freshEarningsResult, freshHalts] = await Promise.all([
    within(
      withServerCache<number | null>(`zerodte:vix-open:${today}`, 10 * 60 * 1000, async () => {
        const bars = await fetchAggBars("I:VIX", 1, "day", today, today);
        const open = bars.length ? bars[0]!.o : null;
        return open != null && Number.isFinite(open) ? open : null;
      }),
      2_500
    ),
    dbConfigured()
      ? within(
          withServerCache<{ direction: "long" | "short" } | null>(
            `zerodte:slayer-live:${today}`,
            30_000,
            async () => {
              const play = await fetchOpenSpxPlay(today).catch(() => null);
              return play ? { direction: play.direction } : null;
            }
          ),
          2_500
        )
      : null,
    freshTickers.length > 0 && dbConfigured()
      ? fetchNighthawkEchoForTickers(freshTickers).catch(
          () => new Map<string, { direction: string; edition_for: string }>()
        )
      : new Map<string, { direction: string; edition_for: string }>(),
    // G-7 macro read. within() → null on timeout/inner-rejection; a SUCCESSFUL fetch
    // returns an array (empty = "zero events today", a SAFE state). Keep that distinction:
    // null (read failed/timed out) → macroUnavailable below → G-7 fails a fresh commit
    // closed; [] → macroEvents empty → G-7 finds nothing to block. (Previously .catch(=>[])
    // collapsed a failed fetch into "zero events" — the exact hole G-7 fail-closed fixes.)
    within(
      withServerCache(`zerodte:macro:${today}`, 10 * 60 * 1000, () => macroEventsOnDateLive(today)),
      2_500
    ).catch(() => null as Awaited<ReturnType<typeof macroEventsOnDateLive>> | null),
    // G-11 earnings for ALL fresh candidates (not just the top-5 dossier): one cached
    // market-wide snapshot (warmed by the same zerodte-warm cron), matched to today/next
    // session. Dynamic import mirrors the vector pre-warm below, keeping the heavy earnings
    // graph out of this module's static import chain.
    //
    // D1 firewall — track the THREE distinct outcomes, never collapsing a failed read into
    // "no earnings" (the exact G-11 fail-OPEN hole, docs/audit/NIGHTHAWK-DATA-PROVENANCE.md):
    //   • nothing to check (freshTickers empty)        → unavailable=false, empty map;
    //   • read SUCCEEDED (snap present, items array)   → unavailable=false, matched map
    //     (an empty map here means "no candidate reports today" — a SAFE state, commits);
    //   • read FAILED — within() timeout OR readGridEarnings() returned null (its typed
    //     failure) OR the catch fired                  → unavailable=TRUE, empty map, and
    //     G-11 fails a fresh commit closed (gates.ts). A failed feed must NOT look identical
    //     to "no earnings" — trading into a print on a blind earnings feed is the danger.
    (async (): Promise<{ map: Map<string, EarningsFlag>; unavailable: boolean }> => {
      if (freshTickers.length === 0) return { map: new Map(), unavailable: false };
      try {
        const { readGridEarnings } = await import("./earnings");
        const snap = await within(readGridEarnings(), 2_500);
        if (!snap) return { map: new Map(), unavailable: true }; // timeout OR typed null failure
        return {
          map: matchEarnings(snap.items ?? [], { today, nextDay: nextTradingDayEt(today) }),
          unavailable: false, // success — an empty match map is genuinely "none report today"
        };
      } catch {
        return { map: new Map(), unavailable: true }; // fetch/import threw — read failed
      }
    })(),
    // G-11 halt for ALL fresh candidates. Two DISTINCT signals, never conflated:
    //   • active (per-ticker): a stored ACTIVE halt on THIS underlying — read with
    //     failClosedOnStale:false so a naturally-quiet halt channel does NOT flag every name
    //     (that read only ever returns true on a genuinely stored halt).
    //   • feedStale (global): the halt FEED itself is cold — isTradingHaltChannelStale() is
    //     true ONLY when BOTH the UW and LULD halt sources read stale (uw-socket.ts). On a
    //     healthy socket the UW source reads FRESH via effectiveFreshestUwMessageAt() — the
    //     freshest message across ALL UW channels (flow/price/tide stream constantly during
    //     RTH), NOT the event-only trading_halts channel's naturally-silent heartbeat. So this
    //     trips ONLY on a real full-socket + LULD outage (dark post-deploy, or died mid-session),
    //     and does NOT starve the board on a normal quiet-halt day (the edition-builder trap).
    // D2 fix: the OLD code read only `active` (failClosedOnStale:false), so a cold/dead halt
    // feed left the store empty and a HALTED underlying could commit a fresh 0DTE. We now ALSO
    // surface feedStale → gates.ts G-11 fails the fresh commit closed (behind the
    // ZERODTE_G11_HALT_FAIL_CLOSED kill-switch). This matches the desk/dossier default, which
    // already reads the halt with fail-closed-on-stale semantics. Best-effort — a thrown import
    // must not empty the board, so on catch feedStale stays false (the pre-D2 behavior).
    (async (): Promise<{ active: Set<string>; feedStale: boolean }> => {
      if (freshTickers.length === 0) return { active: new Set(), feedStale: false };
      try {
        // Relative specifier (not the "@/..." alias) so this dynamic import resolves to the SAME
        // module key the test harness mocks (mock.module("../ws/uw-socket")) — an alias vs relative
        // mismatch forces an extra resolution step that the experimental module-mock loader can lose
        // under concurrent-import contention, silently dropping the block (CI flake). Identical module.
        const { shouldBlockForTradingHalt, isTradingHaltChannelStale, warmUwClusterFreshnessFromRedis } = await import("../ws/uw-socket");
        await warmUwClusterFreshnessFromRedis();
        const active = new Set<string>();
        for (const t of freshTickers) {
          if (shouldBlockForTradingHalt([t], { failClosedOnStale: false }).block) active.add(t);
        }
        return { active, feedStale: isTradingHaltChannelStale() };
      } catch {
        return { active: new Set(), feedStale: false };
      }
    })(),
  ]);
  // Phase-0 firewall signals — cluster-visible LKG + 5m fail-closed stale policy (2026-08-04).
  const now = Date.now();
  const vixResolved = await resolveFirewallNumeric(today, "vix", vixDayOpen, now);
  const effectiveVix = vixResolved.value;
  const vixUnavailable = vixResolved.unavailable;

  const macroResolved = await resolveFirewallMacro(today, macroRead, now);
  const macroEvents = macroResolved.events;
  const macroUnavailable = macroResolved.unavailable;

  const earningsResolved = await resolveFirewallEarnings(today, freshEarningsResult, now);
  const freshEarnings = earningsResolved.map;
  const earningsUnavailable = earningsResolved.unavailable;
  // D2 firewall: the halt read yields a per-ticker ACTIVE-halt set plus one GLOBAL feed-stale
  // flag (both UW + LULD halt sources cold). freshHaltFeedStale gates G-11's halt_feed_stale
  // fail-closed for EVERY committable candidate (see gates.ts G11_HALT_FAIL_CLOSED_ENABLED).
  const freshHaltActive = freshHalts.active;
  const freshHaltFeedStale = freshHalts.feedStale;

  // Regime Plane — one commit-time snapshot for fail-closed fresh opens + exit GEX quality.
  const regimePlane = buildRegimePlaneSnapshot({
    vixDayOpen: effectiveVix,
    vixUnavailable,
    macroUnavailable,
    haltFeedStale: freshHaltFeedStale,
    gexQuality: inferRegimeGexQuality(),
  });

  // Pre-warm the vector-full-state cache for fresh (non-committed) tickers so the
  // sequential Cortex evaluation below hits warm reads (~200ms) instead of cold
  // computes (4-6s). Without this, fetchVectorFullState inside fetchCortexInputs
  // routinely exceeds the per-source timeout, killing 3/8 Cortex sources (gex-walls,
  // wall-trend, darkpool-confluence) and producing near-empty evidence composites.
  if (freshTickers.length > 0) {
    try {
      const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
      await Promise.allSettled(freshTickers.map((t) => fetchVectorFullState(t, "0dte")));
    } catch {
      // Pre-warm is best-effort — Cortex still runs with cold reads and the timeout
    }
  }

  // Setups arrive score-ranked, so the concurrency budget goes to the best finds:
  // committedThisCycle carries earlier accepted fresh commits within this same pass
  // (both for the cap and the correlated-conflict check).
  const committedThisCycle: Array<{ ticker: string; direction: "long" | "short" }> = [];
  for (const s of setups) {
    if (committed.has(s.ticker.toUpperCase())) continue;
    s.gate = evaluateZeroDteGates({
      ticker: s.ticker,
      direction: s.direction,
      // Phase 4: route the gate stack by structure. A CONDOR skips the directional gates (G-1/G-10/
      // G-12/G-6) and runs the condor liquidity + range + harder VIX/macro gates on condor_plan.
      play_type: s.play_type,
      condorPlan: s.condor_plan ?? null,
      score: s.score,
      discovery_origin: s.discovery_origin,
      contractHorizon: s.contract_horizon ?? null,
      nowEtMinutes,
      nowMs,
      bias,
      biasAsOfMs,
      governor,
      committedThisCycle,
      governorPremiumAtRisk,
      governorShortGammaOpen,
      gamma_regime: s.gamma_regime ?? null,
      vixDayOpen: effectiveVix,
      // Phase-0 firewall: G-4 fails a fresh commit closed when the VIX read was attempted
      // but unavailable AND no stale-but-recent fallback exists for this session.
      vixUnavailable,
      slayerLive,
      nighthawkTake: recentNighthawkTake(nhEcho.get(s.ticker.toUpperCase()) ?? null, today),
      macroEvents,
      // Phase-0 firewall: G-7 fails a fresh commit closed when the macro FETCH failed
      // (distinct from "fetched, zero events" — macroEvents empty on the latter).
      macroUnavailable,
      todayYmd: today,
      plan: s.plan ?? null,
      deferPlanQualityGates: thesisFirstEnv().enabled,
      // Moneyness re-check (P0 fix, 2026-08-27): in the ORDINARY (non-thesis-first) pipeline
      // attachContractPlans (and its refreshUnderlyingFromLiveSpot) has already run above (this
      // function is called AFTER that pass — see the caller), so s.otm_pct here is already the
      // live-refreshed value and this closes the hole directly. In the thesis-first pipeline
      // attachContractPlans runs AFTER this call instead, so this otmPct is still the PRE-refresh
      // value — refreshMoneynessGateBlocks (below) re-applies the same caps once the refresh has
      // actually happened, exactly like refreshPlanQualityGateBlocks does for G-8/G-9.
      otmPct: s.otm_pct ?? null,
      intradayConflict: s.intraday_conflict,
      // G-11 for EVERY committable rank: prefer the cheap batch halt/earnings reads
      // (computed for all fresh tickers above) over the dossier-only flags that ranks
      // 6-10 never receive, so no halted / earnings-today name commits regardless of rank.
      // The dossier's own read (top-5) is kept as the fallback where the batch was empty.
      halted: freshHaltActive.has(s.ticker.toUpperCase()) || s.halted === true,
      // D2 firewall: G-11 fails a fresh commit closed when the halt FEED is cold (BOTH UW + LULD
      // halt sources stale) — a dead halt socket can't rule out a halted underlying, and an empty
      // halt store on a dead feed ≠ "no halts". Global (not per-ticker); mirrors earningsUnavailable.
      haltFeedStale: freshHaltFeedStale,
      earnings: freshEarnings.get(s.ticker.toUpperCase()) ?? s.earnings ?? null,
      // D1 firewall: G-11 fails a fresh commit closed when the market-wide earnings read
      // FAILED (timeout/null/throw) — a blind earnings feed can't rule out a print today,
      // and failed-read ≠ no-earnings (mirrors vixUnavailable/macroUnavailable above).
      earningsUnavailable,
      confluence: s.confluence ?? null, // G-12 (Phase 1): attached just above, before this gate pass
      // WS-21 source-recovery gate. DEFAULT-OFF: requireHealthySourceEnabled() is false unless
      // ZERODTE_REQUIRE_HEALTHY_SOURCE=1, in which case the gate is a no-op inside
      // evaluateZeroDteGates and commit behavior is byte-for-byte unchanged. When armed, a fresh
      // commit is withheld until the live UW WS source has reconnected + reconciled its gap + warmed.
      requireHealthySource: requireHealthySourceEnabled(),
      sourceHealth: getFlowSourceHealthState(),
      flowAccumulationAligned: s.flow_accumulation?.aligned ?? null,
      regimeBlockFreshCommits: regimePlane.blockFreshCommits,
      regimeBlockReason: regimePlane.humanReason,
    });
    s.regime_plane = regimePlane;
    if (s.thesis_gate_blocks?.length) {
      const tb = thesisBlocksToGateBlocks(s.thesis_gate_blocks);
      s.gate = {
        ...s.gate,
        verdict: "BLOCKED",
        blocks: [...tb, ...s.gate.blocks],
      };
      continue;
    }
    if (s.gate.verdict !== "COMMIT") continue;

    // ── Night Hawk Cortex layer (NIGHTHAWK-CORTEX-DESIGN.md §2, wired by PR-B) ──
    // Runs on gate SURVIVORS only — the hard gates are the cheap fail-closed floor;
    // the Cortex is the expensive precision layer on top, so it never spends its
    // provider budget arguing about a find the gates already killed. The loop stays
    // sequential ON PURPOSE: a Cortex block must keep this find OUT of
    // committedThisCycle (it will not print), and later finds' governor verdicts
    // (concurrency cap, correlated-conflict) depend on that set being accurate.
    // Latency is bounded: fetchCortexInputs is per-read time-budgeted (2.5s, cache-
    // first readers) and survivors per cycle are few (the governor caps open risk).
    // evaluateCortexForCommit never throws. failClosedOnVetoBlind:true detects when BOTH
    // veto-capable sources (gex-walls + flow-quality) failed to read → VETO_BLIND hard HOLD
    // (fresh commit blocked with cortex_veto_blind) — see cortex-gate.ts for the WHY.
    s.cortex = await evaluateCortexForCommit(s.ticker, s.direction, new Date(nowMs), {}, {
      failClosedOnVetoBlind: true,
    });
    s.cortex = await applyCortexVetoDwell(today, s.ticker, s.cortex);
    const cortexBlocks = cortexGateBlocks(s.cortex);
    if (cortexBlocks.length > 0) {
      // A Cortex veto / net-negative blocks EXACTLY like a hard-gate block:
      // the verdict flips to BLOCKED carrying the Cortex blocks, so the SKIP card, the
      // zerodte_scan_rejections row (code cortex_veto:<source> /
      // cortex_net_negative + evidence sentences) and the fail-closed persist lane all
      // reuse the existing gate plumbing untouched. Gate blocks were empty here (COMMIT).
      s.gate = { ...s.gate, verdict: "BLOCKED", blocks: cortexBlocks };
      continue;
    }
    committedThisCycle.push({ ticker: s.ticker, direction: s.direction });
  }
  return { governorPremiumAtRisk };
}

/**
 * D3: age (ms) of a contract's top-of-book quote at plan time, feeding the WS-04 `stale`
 * predicate (plan.ts). Returns undefined when no quote timestamp is available
 * (`quoteUpdatedMs == null`) so buildContractPlan leaves quoteAgeMs unset and the stale
 * check stays DORMANT for that contract — a MISSING timestamp is never treated as stale
 * (back-compat / fail-open on absence, mirroring the min-size conditional).
 *
 * A NEGATIVE age (quote timestamp ahead of `nowMs`, i.e. clock skew between the provider's
 * quote clock and ours) is floored to 0 = FRESH, never reported as an age that could trip
 * `stale` — skew must not manufacture a staleness block.
 */
export function computeQuoteAgeMs(
  quoteUpdatedMs: number | null | undefined,
  nowMs: number
): number | undefined {
  if (quoteUpdatedMs == null) return undefined;
  const age = nowMs - quoteUpdatedMs;
  return age > 0 ? age : 0;
}

/** One batched quote snapshot for every find's top-strike contract, then a pure
 *  plan per find. Soft-deadlined: a slow quote provider degrades to evidence-only
 *  cards (plan stays null), never a stalled scan. */
async function attachContractPlans(setups: EnrichedZeroDteSetup[]): Promise<void> {
  const occOf = new Map<string, string>();
  for (const s of setups) {
    // A CONDOR carries its own 4-leg priced structure (condor_plan, built at discovery); it has no
    // single directional OCC, so the directional single-contract plan-attach is skipped for it —
    // forcing it through buildOcc/buildContractPlan would fabricate a one-legged plan the gate stack
    // and grader must never see. Its liquidity is gated on condor_plan instead (gates.ts).
    if (s.play_type === "CONDOR") continue;
    const occ = buildOcc(s.ticker, s.expiry, s.direction === "long" ? "call" : "put", s.top_strike);
    if (occ) occOf.set(s.ticker, occ);
  }
  if (occOf.size === 0) return;
  const snaps = await within(
    fetchOptionsUnifiedSnapshot(Array.from(occOf.values())).catch(
      () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
    ),
    5_000 // raised 2.5s→5s — batch snapshot misses were dropping otherwise-committable plans
  );
  if (!snaps) return;
  // Single cycle clock for the whole plan-attach pass so every contract's quote age is measured
  // against the same instant (a per-contract Date.now() would drift across the loop).
  const nowMs = Date.now();
  for (const s of setups) {
    const occ = occOf.get(s.ticker);
    if (!occ) continue;
    const snap = snaps.get(occ) ?? null;
    // ── FROZEN-UNDERLYING FIX ────────────────────────────────────────────────────────
    // The batch we just fetched carries a LIVE underlying (`underlyingPrice`, observed at
    // `observedAtMs`) for every one of these contracts. The FLOW lane's `underlying_price`, by
    // contrast, is whatever underlying one historical UW flow alert carried — the freshest
    // SURVIVING print of a 7h tape — so a name with no new qualifying print kept an hours-old
    // mark forever. Measured live 2026-08-06 against the RTH close: 9/20 board setups >0.5% off,
    // 4 >1%, worst FSLR +2.62% on a 2h18m-old print.
    //
    // Refresh it HERE and nowhere else, because here it is FREE: this is the same single batched
    // unified-snapshot request (≤250 OCCs per call) the scan already makes for contract pricing,
    // so the request volume is UNCHANGED — no per-setup quote fan-out, none of the N+1 shape that
    // was a P0 earlier today (#1789). The refresh also runs BEFORE the `continue` below: a
    // snapshot can carry a live underlying without a usable option mark, and the mark is worth
    // having even when no plan can be built.
    //
    // This closes the exact hole board.ts's no_underlying_price comment flagged — "a live
    // underlying price is available moments later in scan.ts's attachContractPlans
    // (snap?.underlyingPrice) but was never fed back to re-check this gate". CORRECTED
    // 2026-08-27: this restamp alone did NOT close that hole — evaluateZeroDteGates never
    // re-read otm_pct against the moneyness caps at all until gates.ts's `otmPct` input was
    // added (moneynessGateBlocks/refreshMoneynessGateBlocks). In THIS (non-thesis-first)
    // pipeline attachGateVerdicts runs after this pass and now reads the refreshed otm_pct
    // directly, so the moneyness gate does judge the REFRESHED value here; the thesis-first
    // pipeline calls attachContractPlans in the opposite order and must re-run
    // refreshMoneynessGateBlocks afterward (see that call site) to get the same guarantee.
    //
    // When the snapshot has no usable underlying/as-of we do NOT touch the setup: it keeps its
    // older mark WITH its honest `flow_print`/`chain_spot` stamp, so a consumer can still see the
    // age (underlyingMarkAgeMs) and degrade. Never a fresher number with an unknown age.
    const refreshed = refreshUnderlyingFromLiveSpot({
      livePrice: snap?.underlyingPrice,
      liveObservedAtMs: snap?.observedAtMs ?? nowMs,
      direction: s.direction,
      topStrike: s.top_strike,
      hasSingleStrikeMoneyness: s.play_type !== "CONDOR",
    });
    if (refreshed) Object.assign(s, refreshed);
    // No live quote AND no real fill → no plan (evidence only) — never a guess.
    if (!snap?.mark && s.top_strike_avg_fill == null) continue;
    s.plan = buildContractPlan({
      occ,
      direction: s.direction,
      // s.underlying_price is now the REFRESHED live mark when the batch carried one (see above),
      // so the plan geometry is priced off the freshest underlying rather than the flow print's.
      price: s.underlying_price ?? snap?.underlyingPrice ?? null,
      flowAvgFill: s.top_strike_avg_fill,
      bid: snap?.bid ?? null,
      ask: snap?.ask ?? null,
      mark: snap?.mark ?? null,
      // WS-04: resting quote sizes ARE available on OptionSnapshot — thread them through so the
      // min-size predicate (conditional-on-availability) can enforce.
      bidSize: snap?.bidSize ?? null,
      askSize: snap?.askSize ?? null,
      // G-9 freshness = observation clock first (when WE received this book), not the exchange
      // last_quote.last_updated. Live REST often stamps prior close on last_updated while still
      // returning a tradeable NBBO — using that alone produced false plan_quote_stale blocks
      // (FINDINGS 2026-07-29). Fall back to quoteUpdatedMs only when observedAtMs is absent.
      quoteAgeMs: computeQuoteAgeMs(snap?.observedAtMs ?? snap?.quoteUpdatedMs, nowMs),
      keySupports: s.key_supports,
      keyResistances: s.key_resistances,
      vwap: s.vwap,
    });
  }
}

/** Persist a scan's finds into the session ledger (no-op without a database).
 *
 *  Two lanes, split against the committed set:
 *  - REFRESH (ticker already in today's ledger): always upserted — a committed play
 *    is managed to its exit, never retro-blocked, and the upsert's COALESCE pins
 *    keep its plan/entry immutable anyway.
 *  - FRESH commit: must clear the hard gate stack (setup.gate, ./gates.ts). Blocked
 *    finds are persisted to zerodte_scan_rejections (machine code + human sentence)
 *    instead — visible SKIP, never a silent drop. A missing verdict (gate context
 *    unreadable) fails closed, and an unreadable committed set fails the whole
 *    persist closed (can't tell fresh from committed → nothing new may print).
 *
 *  After the 14:00 ET directional cutoff only EXISTING directional plays are refreshed —
 *  a fresh directional flag past NEW_PLAY_CUTOFF never opens. CONDOR is exempt (matches
 *  G-14 + late-theta sell design): fresh index credit seats may still commit when PIN
 *  discovery finds them in the post-cutoff window. */
export async function persistZeroDteScan(setupsIn: EnrichedZeroDteSetup[]): Promise<number> {
  if (!dbConfigured() || setupsIn.length === 0) return 0;
  // HORIZON INTEGRITY fail-closed guard (PR-1, design Q2). The BREAKOUT/PIN/condor pickers are
  // already clamped to dte ≤ 1, so nothing dte≥2 should reach here — but commit is the last gate
  // before a row is graded with the same-day 15:30 time-stop, so we assert the horizon here too.
  // Any WEEKLY_FALLBACK (dte≥2, or a fail-closed unknown horizon) is DROPPED before commit so it
  // never pollutes the 0DTE ledger/calibration with an invalid same-day-graded outcome. This keeps
  // the 0DTE feature-store population structurally HOMOGENEOUS (all rows same-day) — the precondition
  // the later per-horizon calibration versioning (design Q12) depends on.
  const setups = setupsIn.filter((s) => {
    if (isSameDayHorizon(s.contract_horizon)) return true;
    console.warn(
      `[zerodte-horizon] dropping ${s.ticker} from 0DTE commit — horizon=${s.contract_horizon} ` +
        `dte=${s.actual_dte_at_commit} is NOT same-day (weekly fallback excluded from the 0DTE board)`
    );
    return false;
  });
  if (setups.length === 0) return 0;
  const today = todayEt();
  const { hour, minute } = etNowParts();
  const pastCutoff = hour * 60 + minute >= NEW_PLAY_CUTOFF_ET_MINUTES;

  const existingRows = await fetchZeroDteSetupLog(today).catch(() => null);
  if (existingRows == null) return 0; // fail closed: fresh vs committed is unknowable
  const existing = new Set(existingRows.map((r) => r.ticker.toUpperCase()));

  const refresh = setups.filter((s) => existing.has(s.ticker.toUpperCase()));
  // Past directional cutoff: only fresh CONDOR may open (G-14 exempts credit seats; discovery
  // continues for condor-eligible roots only). Directional fresh → empty.
  const freshCandidates = setups.filter((s) => {
    if (existing.has(s.ticker.toUpperCase())) return false;
    if (!pastCutoff) return true;
    return s.play_type === "CONDOR";
  });

  const committedFresh: EnrichedZeroDteSetup[] = [];
  const gateRejections: import("./board").ZeroDteGateRejection[] = [];
  for (const s of freshCandidates) {
    // A CONDOR's tradeability is enforced by the condor liquidity gate INSIDE evaluateZeroDteGates
    // (s.gate already reflects it) — the directional freshCommitBlockedByPlan(s.plan) checks a
    // single-leg plan a condor never has (s.plan is null), so it must not fire on a condor.
    const planBlocked = s.play_type === "CONDOR" ? false : freshCommitBlockedByPlan(s.plan);
    if (s.gate?.verdict === "COMMIT" && !planBlocked) {
      committedFresh.push(s);
      continue;
    }
    let verdict = s.gate;
    if (s.gate?.verdict === "COMMIT" && planBlocked) {
      verdict = {
        ...s.gate,
        verdict: "BLOCKED",
        blocks: [...s.gate.blocks, ...planQualityGateBlocks(s.plan ?? null)],
      };
    }
    gateRejections.push(gateRejectionFor(s, verdict ?? null));
  }
  if (gateRejections.length > 0) {
    // Fail-visible half of the block: best-effort durable record (same throttled
    // write path the evidence-gate near-misses use), logged loudly on failure but
    // never allowed to break the scan itself.
    void persistZeroDteRejections(gateRejections).catch((err) => {
      console.warn("[zerodte-gates] failed to persist gate rejections:", err);
    });
    void persistDiscoveryGateBlockedEvents(gateRejections).catch((err) => {
      console.warn("[zerodte-discovery-events] gate_blocked persist failed:", err);
    });
  }

  const eligible = [...committedFresh, ...refresh];
  if (eligible.length === 0) return 0;

  // Context-at-entry (C-2): one cached session read per scan (day-open VIX + SPY
  // bias), merged per-row with the name's own gamma regime + committed score. The
  // upsert pins it at FIRST flag, so refresh ticks sending fresh context never
  // re-stamp an existing row. Best-effort: null context never blocks a commit.
  // MERGE NOTE (gate lanes × entry_context): this runs on the post-gate `eligible`
  // set only — a hard-gate-BLOCKED fresh find goes to zerodte_scan_rejections and
  // never writes a ledger row, so it never receives an entry_context either.
  const sessionCtx = await fetchZeroDteSessionContext().catch(() => null);
  const committedAtMs = Date.now();
  // Strategy version manifest + config hash (design Q12, strategy-version.ts) — computed ONCE per
  // scan (it's a pure snapshot of the current strategy constants, identical for every row this cycle)
  // and FROZEN onto every committed row below. This is the integrity spine for calibration: a
  // scorer/gate/Cortex/governor/selector/exit/grader change bumps a manifest constant → a new hash →
  // the calibration analyzer keeps the new plays in a fresh cohort instead of blending them with plays
  // the old logic graded. The upsert COALESCE-pins entry_context/feature_vector at first flag, so a
  // manifest bump AFTER a row commits never rewrites that row's stamp.
  // ACTIVE exit archetype: now TIER-AWARE (CTO audit E5 graduation). A/B-tier plays
  // default to trim_scale (proven to dominate ratchet in every backtest window); C-tier
  // stays on the conservative ratchet. The env override `ZERODTE_EXIT_MODE=ratchet` can
  // force all tiers back to ratchet. Because the exit mode now varies per play (it
  // depends on the tier, which is assigned per play inside buildZeroDteEntryContext), the
  // strategy manifest/hash and the resolved exit-policy snapshot are built PER PLAY
  // inside the upsert loop below instead of once per scan. resolveExitMode() (the
  // tier-unaware fallback) is kept for the exit-sync path's own readFrozenExitMode
  // fallback and for any pre-tier rows.
  // (The scan-wide resolveExitMode is still imported but only used as the env-override
  // check; per-play resolution is via resolveExitModeForTier.)
  // WS-05: the open-book snapshot the concentration MEASURE reads — derived from today's ledger the
  // SAME way summarizeGovernorForBoard does (deriveGovernorFromLedger over the committed rows). Plus
  // the sum of entry premium across the currently-OPEN rows ("premium at risk"; the governor's
  // open-plan shape carries no premium, so it's summed here from the full rows). Computed ONCE over
  // the pre-commit open book — every fresh commit this cycle measures against the same snapshot.
  const openPlansAtCommit = deriveGovernorFromLedger(existingRows).open_plans;
  const aggregateOpenPremium = existingRows.reduce(
    (sum, r) => (r.status !== "CLOSED" && typeof r.entry_premium === "number" && Number.isFinite(r.entry_premium) ? sum + r.entry_premium : sum),
    0
  );
  const rows: ZeroDteSetupLogUpsert[] = eligible.map((s) => {
    // PER-PLAY exit mode resolution (CTO audit E5 graduation): build the base entry
    // context first (assigns the merit tier from pinned evidence), then resolve the exit
    // mode from the tier. This replaces the scan-wide resolveExitMode() call — A/B-tier
    // → trim_scale (proven to dominate in every E5 backtest window), C-tier/untiered →
    // ratchet (conservative). The operator env override `ZERODTE_EXIT_MODE` still takes
    // precedence in resolveExitModeForTier.
    const baseEntryCtx = buildZeroDteEntryContext(
      {
        score: s.score,
        gamma_regime: s.gamma_regime,
        cortex: cortexEntryContextFor(s.cortex),
        discovery_origin: s.discovery_origin,
      },
      sessionCtx,
      committedAtMs
    );
    const playTier = baseEntryCtx.tier?.tier ?? null;
    const exitPolicyAtCommit = resolveExitModeForTier(playTier);
    const strategyManifest = buildStrategyManifest({ exitPolicy: exitPolicyAtCommit });
    const strategyHash = strategyConfigHash(strategyManifest);
    const exitPolicySnapshot = buildResolvedExitPolicy(exitPolicyAtCommit);
    return ({
    session_date: today,
    ticker: s.ticker,
    direction: s.direction,
    top_strike: s.top_strike ?? null,
    expiry: s.expiry || null,
    score: s.score,
    dossier_score: s.dossier_score,
    conviction: s.conviction,
    gross_premium: s.gross_premium,
    spike: s.spike,
    underlying: s.underlying_price,
    // Premium reference the plan grades against — entry_max (the member's actual
    // "enter at or below" instruction), FLOORED at the flag-time mark so the graded
    // basis is one a member could actually fill: a flow fill that sits below the live
    // mark can't be gotten by someone arriving at flag time, and grading off it flatters
    // the win rate (see resolveLedgerEntryPremium's doc comment, plan.ts). The mark is
    // pinned here — the upsert COALESCEs entry_premium first-write-wins, so it's the
    // flag-time mark, never a later refresh tick.
    //
    // CONDOR: s.plan/s.top_strike_avg_fill are always null (a condor has no single-leg
    // plan), so resolveLedgerEntryPremium(null, null, ...) used to return null for EVERY
    // condor row — permanently. Consequence: aggregatePremiumAtRisk (governor.ts) sums
    // entry_premium across open rows for the session premium-at-risk budget, so an open
    // condor's real risk (net_credit) was silently invisible to the governor the whole
    // time it was open. condor_plan.net_credit is priced in $×100-per-contract units (see
    // its doc comment) while entry_premium is per-share throughout this ledger (matching
    // directional plays, e.g. $0.57) — divided by 100 here to stay in that same unit, so
    // the aggregate sums apples to apples. Found 2026-08-26.
    //
    // This does NOT restore live per-play condor P&L display: condorSellerPnlPct still
    // needs a live MARK, and syncLedgerLiveState's mark-fetch keys strictly off a
    // single-leg plan_json.occ, which a condor row never has — there is no multi-leg
    // (4-leg) mark-fetch path anywhere in scan.ts/live-marks.ts. That is a separate,
    // larger gap (a new fetch pipeline, not a one-line fix) — left OPEN, not fixed here;
    // see the companion findings-staging entry.
    entry_premium:
      s.play_type === "CONDOR"
        ? s.condor_plan?.net_credit != null
          ? Math.round((s.condor_plan.net_credit / 100) * 100) / 100
          : null
        : resolveLedgerEntryPremium(s.plan?.entry_max, s.top_strike_avg_fill, s.plan?.mark),
    flow_avg_fill: s.top_strike_avg_fill,
    plan_json: s.plan ? ({ ...s.plan } as unknown as Record<string, unknown>) : null,
    // G-4/G-6 calibration verdict at commit (C-2 context columns). Refresh-lane
    // setups carry gate=null and pass null here — the upsert's COALESCE pin keeps
    // the original commit-time verdict untouched either way.
    gate_calibration_json: s.gate ? ({ ...s.gate.calibration } as unknown as Record<string, unknown>) : null,
    // entry_context.cortex pins the FULL evidence vector (or the honest abstain
    // record) at commit — the §3.1 calibration loop's raw material. Refresh-lane
    // setups never ran the Cortex (s.cortex null → blob field null), and the
    // upsert's COALESCE pin keeps the original commit-time context untouched
    // either way. Blocked finds never reach this map at all — they went to
    // zerodte_scan_rejections above and never write entry_context.
    entry_context: {
      ...baseEntryCtx,
      // Pin the two calibration-first evidence signals at first flag so the graded ledger can bucket
      // outcomes by them (calibration.ts) and let each graduate into scoring ON EVIDENCE — the read
      // itself still does NOT gate the board. Omitted when absent so the blob stays honest.
      ...(s.flow_accumulation ? { flow_accumulation: s.flow_accumulation } : {}),
      ...(s.confluence ? { confluence: s.confluence } : {}),
      ...(s.regime_plane ? { regime_plane: s.regime_plane } : {}),
      // Dossier factor weights at commit — drives thesis-health evidence profile (weighted pillars).
      ...(s.factor_breakdown ? { factor_breakdown: { ...s.factor_breakdown } } : {}),
      // Discovery provenance SET (Phase 3a) pinned at first flag — the whole point of the origin
      // work: it must survive to the graded ledger so the calibration origin band can slice WR/PnL
      // by FLOW / BREAKOUT / FLOW+BREAKOUT. Always present (flow-only setups persist ["FLOW"]).
      discovery_origin: s.discovery_origin,
      // "Why now" trigger reason (Wave 3) — the ONE event that surfaced this play (multi-day
      // accumulation / breakout / gamma pin / sweep / flow spike / aggressor flow), derived from
      // the SAME committed signals so the terminal can show an honest "⚡ triggered by …" ribbon.
      // Pinned here so it survives for a working position long after the fresh scan; omitted when
      // no committed signal supports a reason (never a fabricated trigger).
      ...((): Record<string, unknown> => {
        const wn = deriveWhyNow({
          discovery_origin: s.discovery_origin,
          sweep_pct: s.sweep_pct,
          spike: s.spike,
          flow_accumulation: s.flow_accumulation,
        });
        return wn ? { why_now: wn } : {};
      })(),
      // Opposing-direction co-discovery (design Q1) pinned when a second origin found this
      // ticker the OTHER way — evidence for the calibration origin band, never a commit change.
      // Present only on a real conflict so the blob stays honest for the common (agreeing) case.
      ...(s.origin_direction_conflict ? { origin_direction_conflict: s.origin_direction_conflict } : {}),
      ...(s.thesis_first
        ? { thesis_first: thesisFirstEntryContext(s.thesis_first) }
        : {}),
      // Play STRUCTURE (Phase 4) pinned at first flag: play_type routes the CONDOR grade path in
      // gradeZeroDteLedger (a condor is graded WIN/breach, never on the −50/+100 directional grader)
      // and the calibration play-type band. The full priced condor geometry rides along for the
      // graded ledger's realized credit/loss. Always DIRECTIONAL unless the condor router fired.
      play_type: s.play_type,
      ...(s.play_type === "CONDOR" && s.condor_plan ? { condor: s.condor_plan } : {}),
      // Contract HORIZON pinned at first flag (PR-1 horizon integrity). Only ZERO_DTE/ONE_DTE ever
      // reach here (the guard above dropped any weekly fallback), so grading can ASSERT same-day
      // before applying the 15:30 time-stop instead of inferring the horizon from expiry vs date.
      contract_horizon: s.contract_horizon,
      actual_dte_at_commit: s.actual_dte_at_commit,
      grading_policy: s.grading_policy,
      // Strategy version manifest + hash frozen at first flag (design Q12). The hash is calibration's
      // cohort key (calibration.ts partitions graded rows by it); the full manifest rides along so an
      // operator reading a row in isolation sees exactly which strategy version produced it, and a
      // future hash mismatch can be attributed to the specific subsystem that was bumped.
      strategy_manifest: strategyManifest,
      strategy_config_hash: strategyHash,
      // Exit archetype FROZEN at first flag (design Q13). evaluateLedgerRowExit reads this
      // (readFrozenExitMode) in preference to the live env, so an open play always exits
      // under the policy it committed with — a mid-session tier-based resolution only
      // steers plays committed afterward, never re-manages a live position.
      exit_policy_at_commit: exitPolicyAtCommit,
      // WS-02 — the IMMUTABLE, fully-resolved exit-policy snapshot (numeric stop/target/trims/
      // time-stop/collision + its own config_hash). Frozen so the grader replays this row under the
      // numbers it COMMITTED with, never whatever PLAN_RULES holds at grade time. readFrozenExitPolicy
      // reads it; null (legacy row) → graders fall back to current code, byte-for-byte prior behavior.
      exit_policy_snapshot: exitPolicySnapshot,
      // WS-05 — concentration STATE frozen at commit (MEASURE ONLY, no gating): how concentrated the
      // open book was, from the SAME inputs summarizeGovernorForBoard uses (governor.open_plans +
      // CORRELATION_GROUPS). Lets calibration ask "how concentrated was the book when this committed?"
      // on the graded ledger before concentration is ever flipped from a measure to a gate (Q9).
      concentration: freezeConcentrationState(
        { ticker: s.ticker, direction: s.direction },
        openPlansAtCommit,
        { aggregatePremiumAtRisk: aggregateOpenPremium }
      ),
      // WS-06 — FULL origin maps: every discovery rail's (direction, score) at merge + which rail owned
      // the kept direction + all disagreements (not just the first conflict pair). Evidence only.
      origin_maps: buildOriginMaps(s),
      // WS-14 — INPUT-AGE MANIFEST frozen at commit: the age (ms) at decision time of each input the
      // decision used. Computed from timestamps ON the setup at commit (flow = freshest print
      // `last_seen`; underlying = the name's own last minute bar). The remaining inputs (option quote,
      // GEX, VIX, macro, SPY bias) carry no per-value timestamp into this commit function, so they are
      // honestly null (the "never fabricate an unknown age" rule) rather than back-filled from a cache
      // TTL. Observability only — never re-read as a decision input.
      input_age_manifest: buildInputAgeManifest(
        {
          flow_at: s.last_seen ? Date.parse(s.last_seen) : null,
          underlying_at: s.intraday?.last_bar_ms ?? null,
          option_quote_at: null,
          gex_at: null,
          vix_at: null,
          macro_at: null,
          spy_bias_at: null,
        },
        committedAtMs
      ),
    } as unknown as Record<string, unknown>,
    flags_json: {
      ...(s.earnings ? { earnings: s.earnings } : {}),
      ...(s.news_hot ? { news_hot: s.news_hot.title } : {}),
      ...(s.halted ? { halted: true } : {}),
      ...(s.fib_note ? { fib: s.fib_note.label } : {}),
      ...(s.direction_confirmed != null ? { dossier_agrees: s.direction_confirmed } : {}),
    },
    // Feature vector pinned at first flag — the intelligence layer's raw material (feature-vector.ts),
    // COALESCE-pinned by the upsert so refresh ticks never re-stamp a committed row. Both engines are
    // now threaded: flowQuality from the aggregation site (board.ts, per-setup tape) and regime from
    // the session-context fetch (SPY proxy, session-level) — no fq_*/reg_* field persists a deferred
    // null anymore when the data is present.
    feature_vector: buildSetupFeatureVector({
      ticker: s.ticker,
      direction: s.direction,
      etMinutes: hour * 60 + minute - 570, // minutes since the 9:30 ET open (570)
      evidenceScore: s.score,
      flowQuality: s.flow_quality ?? null,
      regime: sessionCtx?.regime ?? null,
      dossierScore: s.dossier_score ?? null,
      vwapDistPct: s.intraday?.vwap_dist_pct ?? null,
      orBreak: s.intraday?.or_break ?? null,
      trend5m: s.intraday?.trend_5m ?? null,
      rsi14: s.rsi14 ?? null,
      relVolume: s.rel_volume ?? null,
      atr14: s.atr14 ?? null,
      gammaRegime: s.gamma_regime ?? null,
      gexKingDistPct:
        s.gex_king_strike != null && s.underlying_price
          ? ((s.gex_king_strike - s.underlying_price) / s.underlying_price) * 100
          : null,
      darkPoolBias: (s.dark_pool_bias as "bullish" | "bearish" | "mixed" | null) ?? null,
      vix: sessionCtx?.vix_open ?? null,
      spyBias: sessionCtx?.spy_bias ?? null,
      confluence: s.confluence?.tier ?? null,
      discoveryOrigin: s.discovery_origin,
      // Contract horizon at commit (PR-1). Only ZERO_DTE/ONE_DTE reach here (weekly fallbacks were
      // dropped above), so the feature store stays same-day homogeneous — the population invariant
      // the per-horizon calibration versioning (design Q12) relies on.
      contractHorizon: s.contract_horizon,
      actualDteAtCommit: s.actual_dte_at_commit,
      // Same frozen hash as entry_context above (design Q12) — stamped on the feature vector too so
      // the intelligence/feature layer can partition its own population by strategy version.
      strategyConfigHash: strategyHash,
      // WS-06: the origin owner + merge version flattened onto the vector (full maps ride in
      // entry_context.origin_maps) so the feature store can slice/one-hot by which rail owned the take.
      directionOwner: buildOriginMaps(s).direction_owner,
      mergePolicyVersion: MERGE_POLICY_VERSION,
    }) as unknown as Record<string, unknown>,
  }); });
  // WS-01 — split the write into the FRESH lane (new exposure, cap-limited) and the
  // REFRESH lane (tickers already open — never new exposure, never cap-limited). `eligible`
  // is [...committedFresh, ...refresh] IN THAT ORDER, so `rows` aligns index-for-index: the
  // first committedFresh.length rows are the fresh commits, the rest are refresh ticks.
  const freshPairs = committedFresh.map((setup, i) => ({ setup, row: rows[i]! }));
  const refreshRows = rows.slice(committedFresh.length);

  // Refresh rows upsert exactly as before — a committed play is managed to its exit, never
  // retro-blocked, and every plan/context field is COALESCE-pinned so a refresh can't move it.
  const freshlyFlagged = new Set<string>();
  if (refreshRows.length > 0) {
    for (const t of await upsertZeroDteSetupLog(refreshRows)) freshlyFlagged.add(t);
  }

  // Fresh commits go through the ATOMIC path: a Postgres xact advisory lock keyed by the
  // session date serializes the whole count→re-evaluate→insert against any concurrent
  // committer (the member-poll scan, the cron warm, or a second ECS replica). Inside the
  // lock we RE-DERIVE the governor snapshot from a fresh in-transaction ledger read — the
  // transactional recount that sees a racing writer's just-committed rows — and re-run the
  // PURE governor per candidate IN SCORE ORDER, threading the candidates already accepted
  // this transaction into `committedThisCycle` exactly as the pure function expects. A
  // candidate that now blocks (the loser of a race past the 3-concurrent cap) is DROPPED and
  // recorded to zerodte_scan_rejections so the withhold is fail-VISIBLE, not silent. When
  // uncontended the recount equals the scan-time snapshot, so the SAME candidates commit —
  // behavior-identical. This channel can only ever WITHHOLD an over-cap commit, never add one.
  if (freshPairs.length > 0) {
    const recountRejections: import("./board").ZeroDteGateRejection[] = [];
    const atomicSelect = (currentLedger: ZeroDteSetupLogRow[]): ZeroDteSetupLogUpsert[] => {
      const snap = deriveGovernorFromLedger(currentLedger);
      const acceptedThisTxn: GovernorOpenPlan[] = [];
      const survivors: ZeroDteSetupLogUpsert[] = [];
      // Score-descending: the governor's committedThisCycle threading only bounds a single
      // cycle correctly when the highest-conviction candidates are offered the last open slots
      // first (the same order the scan-time gate applied it).
      const ordered = [...freshPairs].sort((a, b) => b.setup.score - a.setup.score);
      const premiumAtRisk = aggregatePremiumAtRisk(currentLedger);
      const shortGammaOpen = countShortGammaOpen(currentLedger);
      const { hour, minute } = etNowParts();
      const recountEtMinutes = hour * 60 + minute;
      for (const { setup, row } of ordered) {
        const blocks = evaluateZeroDteGovernor(
          {
            ticker: setup.ticker,
            direction: setup.direction,
            entry_premium: row.entry_premium ?? setup.plan?.entry_max ?? setup.plan?.mark ?? null,
            gamma_regime: setup.gamma_regime ?? null,
          },
          snap,
          committedAtMs,
          acceptedThisTxn,
          { etMinutes: recountEtMinutes, premiumAtRisk, shortGammaOpen }
        );
        if (blocks.length > 0) {
          // Dropped by the transactional recount — durable, visible SKIP with the governor
          // reason (same rejection bridge the scan-time gate blocks use).
          recountRejections.push(
            gateRejectionFor(setup, setup.gate ? { ...setup.gate, verdict: "BLOCKED", blocks } : null)
          );
          continue;
        }
        acceptedThisTxn.push({ ticker: setup.ticker.toUpperCase(), direction: setup.direction });
        survivors.push(row);
      }
      return survivors;
    };

    const atomicResult = await commitFreshZeroDteRowsAtomic(today, atomicSelect);
    if (atomicResult != null) {
      // Atomic commit succeeded — record any recount drops (best-effort, never blocks the scan).
      for (const t of atomicResult) freshlyFlagged.add(t);
      if (recountRejections.length > 0) {
        void persistZeroDteRejections(recountRejections).catch((err) => {
          console.warn("[zerodte-atomic] failed to persist recount-drop rejections:", err);
        });
      }
    } else {
      // Fallback: the atomic path could not run (db down / lock or txn error). It ROLLED BACK,
      // so nothing was inserted and this plain upsert cannot double-insert. No recount happened,
      // so we do NOT emit recountRejections here (they only describe a race that didn't occur).
      for (const t of await upsertZeroDteSetupLog(freshPairs.map((p) => p.row))) freshlyFlagged.add(t);
    }
  }

  if (freshlyFlagged.size > 0) {
    const freshRows = eligible.filter((s) => freshlyFlagged.has(s.ticker.toUpperCase()));
    recordZeroDteAuditTrail(freshRows, today);
    for (const setup of freshRows) {
      void import("./discord-trade-notify")
        .then(({ notifyZeroDteTradeOpen }) =>
          notifyZeroDteTradeOpen({
            session_date: today,
            ticker: setup.ticker,
            direction: setup.direction,
            top_strike: setup.top_strike ?? null,
            expiry: setup.expiry || null,
            entry_premium:
              setup.play_type === "CONDOR"
                ? setup.condor_plan?.net_credit != null
                  ? Math.round((setup.condor_plan.net_credit / 100) * 100) / 100
                  : null
                : resolveLedgerEntryPremium(
                    setup.plan?.entry_max,
                    setup.top_strike_avg_fill,
                    setup.plan?.mark
                  ),
            play_type: setup.play_type ?? null,
          })
        )
        .catch((err) => {
          console.warn(`[zerodte-discord] open notify failed for ${setup.ticker}:`, err);
        });
    }
    void persistDiscoveryCommitEvents(
      committedFresh.filter((s) => freshlyFlagged.has(s.ticker.toUpperCase()))
    ).catch((err) => {
      console.warn("[zerodte-discovery-events] commit persist failed:", err);
    });
    // WS-15 committed-row write counter + WS-14 per-origin end-to-end commit latency
    // (observability only, best-effort). Counts genuinely-fresh commits (not refresh ticks);
    // latency = freshest flow print (`last_seen`) → commit instant, bucketed by discovery origin.
    recordCommittedRows(today, freshRows.length);
    for (const s of freshRows) {
      const flowAt = s.last_seen ? Date.parse(s.last_seen) : NaN;
      if (Number.isFinite(flowAt)) recordCommitLatency(s.discovery_origin, committedAtMs - flowAt);
    }
  }
  // WS-01: report what was ACTUALLY written, not what was attempted. freshlyFlagged counts the
  // fresh inserts (refresh ticks never appear — they conflict, xmax≠0); adding the refresh rows
  // back gives the same total as the pre-fix `rows.length` when uncontended (all fresh survive),
  // but honestly excludes a candidate the transactional recount dropped past the cap.
  return freshlyFlagged.size + refreshRows.length;
}

/** Stage 4 audit trail: fire-and-forget, one row per setup, ONLY for setups that
 *  were a fresh insert this cycle (see upsertZeroDteSetupLog) — a later refresh of
 *  the same session/ticker never writes a second audit row. Failures are logged,
 *  never thrown — the audit trail must not be able to break the scanner. */
function recordZeroDteAuditTrail(freshSetups: EnrichedZeroDteSetup[], sessionDate: string): void {
  for (const setup of freshSetups) {
    const row = buildZeroDteAuditRow(setup, sessionDate);
    void insertAlertAuditLog(row).catch((err) => {
      console.warn(`[zerodte-audit] failed to write alert_audit_log for ${setup.ticker}:`, err);
    });
  }
}

// Lazy grading throttle — grading is idempotent and cheap (≤12 rows × 1 daily-bar
// call), but there is no reason to attempt it more than once per interval per replica.
let lastGradeAttemptMs = 0;
const GRADE_ATTEMPT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Grade ungraded ledger rows from FINISHED sessions against their official close
 * (Polygon daily bar for that exact date). Lazy: called opportunistically from the
 * scan warm and board builds — no dedicated cron needed.
 */
export async function gradeZeroDteLedger(force = false): Promise<number> {
  if (!dbConfigured()) return 0;
  const now = Date.now();
  if (!force && now - lastGradeAttemptMs < GRADE_ATTEMPT_INTERVAL_MS) return 0;
  lastGradeAttemptMs = now;

  const today = todayEt();
  const ungraded = await fetchUngradedZeroDteRows(today).catch(() => [] as ZeroDteSetupLogRow[]);
  let graded = 0;
  for (const row of ungraded) {
    try {
      // ── CONDOR grade (Phase 4) — routed by the pinned play_type, NEVER the −50/+100 directional
      // grader. A condor row carries no single-leg occ (its structure is the pinned entry_context.
      // condor blob), so the directional plan-grade below is a no-op for it; instead grade the SOLD
      // structure against the UNDERLYING's minute bars (WIN=close-inside-both-shorts / breach=defined
      // loss, condor.ts) and store the realized outcome/credit-loss in the same plan_outcome/pnl
      // columns. The directional-move grade still runs afterward (harmless provenance) and stamps
      // graded_at. Guarded strictly on play_type === "CONDOR", so a directional row is byte-identical.
      const ec = row.entry_context ?? null;
      // HORIZON assertion (PR-1, design Q2): the plan/condor grades below apply the SAME-DAY 15:30
      // time-stop (plan.ts / condor.ts). That is only valid for a same-day (ZERO_DTE/ONE_DTE)
      // contract. Read the pinned horizon and, if it is KNOWN to be non-same-day (a weekly fallback
      // that somehow reached the ledger despite the commit guard), SKIP the same-day intraday grades
      // so we never stamp an invalid 15:30 outcome. Legacy rows predate this pin (horizon absent) →
      // undefined, and grade unchanged. `isSameDayHorizon` fail-closes an unknown string to false,
      // so only a horizon explicitly ZERO_DTE/ONE_DTE (or a legacy null) is graded same-day.
      const pinnedHorizon = typeof ec?.contract_horizon === "string" ? ec.contract_horizon : null;
      const sameDayOk =
        pinnedHorizon == null || isSameDayHorizon(pinnedHorizon as import("./board").ContractHorizon);
      if (!sameDayOk) {
        console.warn(
          `[zerodte-horizon] skipping same-day grade for ${row.ticker} ${row.session_date} — ` +
            `entry_context.contract_horizon=${pinnedHorizon} is not same-day (should never have committed)`
        );
      }
      // WS-02: grade under the row's FROZEN exit-policy snapshot (the numbers it committed
      // under) when present; null → the graders fall back to current-code PLAN_RULES (legacy
      // rows grade exactly as before). Read once here and threaded into both grade paths.
      const frozenExitPolicy = readFrozenExitPolicy(ec as Record<string, unknown> | null);
      const graderParams = frozenExitPolicy ? exitPolicyGraderParams(frozenExitPolicy) : null;
      const isCondorRow = ec?.play_type === "CONDOR";
      const condorGeom = (ec?.condor ?? null) as Record<string, unknown> | null;
      if (sameDayOk && isCondorRow && row.plan_outcome == null && condorGeom && row.first_flagged_at) {
        const minBars = await fetchAggBars(
          polygonSpotTicker(row.ticker), 1, "minute", row.session_date, row.session_date, "50000"
        );
        const bars: PlanBar[] = minBars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c }));
        const geom = {
          breach_lower: Number(condorGeom.breach_lower),
          breach_upper: Number(condorGeom.breach_upper),
          net_credit: condorGeom.net_credit == null ? null : Number(condorGeom.net_credit),
          max_loss: condorGeom.max_loss == null ? null : Number(condorGeom.max_loss),
          gross_wing_risk: Number(condorGeom.gross_wing_risk),
          // Q7 mid-fill bracket, pinned on the plan at commit; null for a pre-Q7 row so the grader's
          // realized_usd_mid stays null (never fabricated).
          net_credit_mid: condorGeom.net_credit_mid == null ? null : Number(condorGeom.net_credit_mid),
        };
        const cGrade = gradeCondorFromBars(
          bars,
          geom,
          Date.parse(row.first_flagged_at),
          graderParams ? { time_stop_et_minutes: graderParams.time_stop_et_minutes } : null
        );
        await updateZeroDtePlanOutcome(row.session_date, row.ticker, {
          plan_outcome: cGrade.outcome,
          plan_pnl_pct: cGrade.pnl_pct,
        });
      }
      // Plan grade FIRST (against the contract's own minute bars), then the
      // direction grade — gradeZeroDteSetupRow stamps graded_at, which removes the
      // row from future passes, so everything must land in this one try.
      const occ = typeof row.plan_json?.occ === "string" ? row.plan_json.occ : null;
      if (sameDayOk && !isCondorRow && row.plan_outcome == null && occ && row.entry_premium != null && row.entry_premium > 0) {
        const optBars = await fetchAggBars(occ, 1, "minute", row.session_date, row.session_date, "50000");
        const planBars: PlanBar[] = optBars
          .filter((b) => b.t != null && Number.isFinite(b.t))
          .map((b) => ({ t: b.t as number, h: b.h, l: b.l, c: b.c }));
        const flaggedAtMs = Date.parse(row.first_flagged_at);
        const planGrade = gradePlanFromBars(planBars, row.entry_premium, flaggedAtMs, graderParams);
        await updateZeroDtePlanOutcome(row.session_date, row.ticker, {
          plan_outcome: planGrade.outcome,
          plan_pnl_pct: planGrade.pnl_pct,
        });
        // WS-10 — the OFFICIAL conservative-EXECUTABLE grade (entry=ask, exit=bid) beside the mid
        // grade above. The mid grade stays in plan_pnl_pct (monitoring/comparison); the executable
        // grade is pinned additively at entry_context.executable (stampZeroDteExecutableGrade) and
        // is what calibration + the record read (officialPlanPnlPct). The half-spread fraction is
        // the row's OWN entry quote (plan_json.bid/ask, pinned at commit — the real spread it
        // committed under), falling back to the conservative default only when that book was
        // one-sided/absent. A long-premium 0DTE play buys the ask and sells the bid in BOTH
        // directions (call="long"/put="short"), so the model is direction-independent here; the
        // condor path never reaches this block (routed to gradeCondorFromBars above).
        const planQuote = row.plan_json as { bid?: unknown; ask?: unknown } | null;
        const entryBid = typeof planQuote?.bid === "number" ? planQuote.bid : null;
        const entryAsk = typeof planQuote?.ask === "number" ? planQuote.ask : null;
        const halfSpreadFrac = zeroDteHalfSpreadFrac(entryBid, entryAsk) ?? ZERODTE_DEFAULT_HALF_SPREAD_FRAC;
        // WS-11 — grade the STRATEGY the engine actually runs. When the row's FROZEN exit policy
        // (WS-02 snapshot) is trim_scale, the OFFICIAL executable grade is the RECONSTRUCTED
        // ⅓/⅓/⅓ scale-out path (reconstructTrimScaleExecutableFromBars), not a single stop/target
        // walk — so calibration + the member record grade the same partial-banking path the member
        // is guided to trade. Ratchet and legacy/no-snapshot rows keep the single-exit executable
        // walk (gradePlanExecutableFromBars) — ratchet stays single-exit by design. The trim ladder
        // (levels + runner fraction) comes straight off the frozen snapshot, so a later constant
        // edit can never retroactively re-reconstruct a historical row.
        const trimSpec: TrimScaleSpec | null =
          frozenExitPolicy?.policy === "trim_scale" &&
          Array.isArray(frozenExitPolicy.trim_levels) &&
          frozenExitPolicy.trim_levels.length > 0
            ? { trim_levels: frozenExitPolicy.trim_levels, runner_fraction: frozenExitPolicy.runner_fraction }
            : null;
        const execGrade = trimSpec
          ? reconstructTrimScaleExecutableFromBars(
              planBars,
              row.entry_premium,
              flaggedAtMs,
              halfSpreadFrac,
              trimSpec,
              graderParams
            )
          : gradePlanExecutableFromBars(planBars, row.entry_premium, flaggedAtMs, halfSpreadFrac, graderParams);
        const taxBps = executionTaxBps(planGrade.pnl_pct, execGrade.pnl_pct);
        const executableBlob: Record<string, unknown> = {
          lane: "conservative",
          entry_basis: "ask",
          exit_basis: "bid",
          half_spread_frac: halfSpreadFrac,
          plan_outcome: execGrade.outcome,
          plan_pnl_pct: execGrade.pnl_pct,
          mid_plan_outcome: planGrade.outcome,
          mid_plan_pnl_pct: planGrade.pnl_pct,
          execution_tax_bps: taxBps,
          // WS-11 — the per-leg fills of the reconstructed TRIM-SCALE path (null for the
          // ratchet/legacy single-exit walk). Their presence is the signal record.ts reads to
          // route the AS-MANAGED headline to this reconstruction (the canonical official number).
          tranches: execGrade.tranches ?? null,
          exit_policy: trimSpec ? "trim_scale" : (frozenExitPolicy?.policy ?? "ratchet"),
          // Lane (c): reserved for a future real broker-fill integration. Shape defined,
          // deliberately unpopulated (no live fill source yet).
          broker: null,
        };
        await stampZeroDteExecutableGrade(row.session_date, row.ticker, executableBlob);
        // WS-10 execution-tax histogram (bps = mid − executable), beside the sibling calibration
        // metrics. Best-effort; skipped when either lane was ungradeable (tax null).
        recordExecutionTaxBps(taxBps);
        // WS-11 reconciliation guard — measured ONLY on reconstructed TRIM-SCALE rows, the ones
        // the reconciliation applies to. On the SAME row (with the freshly-built executable blob)
        // the OFFICIAL number (officialPlanPnlPct) and the member AS-MANAGED number (asManagedPnlPct)
        // must agree — the reconstruction IS both — so this delta sits at ~0; a non-zero percentile
        // means the reconciliation regressed. Ratchet/legacy rows are DELIBERATELY excluded: their
        // mechanical grade (hold-to-stop) and as-managed (the live ratchet exit) differ by design,
        // so recording them would pollute the invariant. Best-effort; never blocks the grade.
        if (trimSpec) {
          const rowWithExecutable = {
            ...row,
            entry_context: { ...(ec ?? {}), executable: executableBlob },
          } as typeof row;
          const officialPnl = officialPlanPnlPct(rowWithExecutable);
          const asManaged = asManagedPnlPct(rowWithExecutable);
          recordGradeVsAsManagedDeltaBps(
            officialPnl != null && asManaged != null ? (officialPnl - asManaged) * 100 : null
          );
        }
        // WS-15 committed-ungradeable rate (observability only): a committed row the grader could
        // not resolve to a real outcome (no post-flag minute bars / zero entry basis). Best-effort
        // counter — does NOT change the stamped outcome or any grade decision.
        if (planGrade.outcome === "ungradeable") recordUngradeable(row.session_date);
      }
      // polygonSpotTicker: an index-root row (SPXW/SPX/NDX…) must fetch its close
      // from the I: index symbol — the raw root "succeeds" with 0 results, which
      // would stamp the row graded with a permanent null direction grade (the
      // catch-and-retry path only covers thrown fetches, not empty ones).
      const bars = await fetchAggBars(polygonSpotTicker(row.ticker), 1, "day", row.session_date, row.session_date);
      const close = bars.length ? bars[bars.length - 1]!.c : null;
      // A KNOWN index root returning ZERO bars is a transient provider gap, not a real
      // "no close": the mapped I: symbol always has a daily bar for a finished session,
      // so an empty result means the fetch degraded (rate limit, propagation lag), not
      // that the index didn't trade. Stamping it now freezes a PERMANENT null direction
      // grade — gradeZeroDteSetupRow sets graded_at, removing the row from every future
      // pass. So treat empty bars for a mapped index root as a RETRYABLE non-grade,
      // mirroring the throw path: leave it ungraded and let the next lazy pass retry.
      // The plan grade written above is idempotent (skipped next pass once plan_outcome
      // is set), so only the direction grade retries. Equities are unchanged: a missing
      // daily bar there is a real gap and the clean path still stamps it.
      if (close == null && INDEX_OPTION_ROOTS.includes(row.ticker.toUpperCase())) {
        continue;
      }
      const grade = computeLedgerGrade(row.direction, row.underlying_at_flag, close ?? null);
      await gradeZeroDteSetupRow(row.session_date, row.ticker, grade);
      graded += 1;
    } catch {
      // Leave the row ungraded — the next lazy pass retries it.
    }
  }
  return graded;
}

/**
 * Cron entry (piggybacked on grid-warm, ~every 2 min through RTH): run the scan,
 * persist finds to the ledger, opportunistically grade past sessions. Returns a
 * small summary object (grid-warm counts a non-null result as a successful warm).
 */
export async function warmZeroDteBoard(): Promise<{ found: number; logged: number } | null> {
  const { setups, rejections, market_state } = await scanZeroDteBoard();
  // NH-R10: record this scan cycle's tick as soon as scanZeroDteBoard() has actually
  // returned — this is the always-on cron cadence tick (distinct from the member-poll
  // board route), so a silent stall here is the same class of blind spot the SPX play
  // engine heartbeat was built to catch. Heartbeat persistence must never break the
  // real board pipeline, so failures are swallowed exactly like the other best-effort
  // side-tasks in this function (near-miss log, discovery events, ledger sync below).
  void recordZeroDteScanTick("cron").catch((err) => {
    console.warn("[zerodte-scan-heartbeat] tick record failed:", err);
  });
  const logged = await persistZeroDteScan(setups).catch(() => 0);
  // Near-miss log (task #147) — same cron cadence persistZeroDteScan uses above,
  // never the member-poll board route. Best-effort: a failure here must never
  // affect the real board setups above.
  void persistZeroDteRejections(rejections).catch(() => 0);
  void persistDiscoveryDetectedEvents(setups, market_state).catch((err) => {
    console.warn("[zerodte-discovery-events] detected persist failed:", err);
  });
  void persistDiscoveryGateBlockedEvents(rejections).catch((err) => {
    console.warn("[zerodte-discovery-events] flow near-miss persist failed:", err);
  });
  // Keep every live play's OPEN/HOLD/TRIM/CLOSED state fresh even when nobody is
  // watching — the guidance runs on the cron, not on page views.
  await readZeroDteLedger().then(syncLedgerLiveState).catch(() => {});
  void gradeZeroDteLedger().catch(() => {});
  return { found: setups.length, logged };
}

/** Last successful ledger read this session (per replica) — the presentation half
 *  of the one-way commit door. See readZeroDteLedgerChecked for WHY. */
let lastGoodLedger: { date: string; rows: ZeroDteSetupLogRow[] } | null = null;

export type ZeroDteLedgerRead = {
  rows: ZeroDteSetupLogRow[];
  /** True when `rows` is a trustworthy committed set for today (a fresh read, or a
   *  same-session snapshot standing in for one transient failed read). False ONLY
   *  when the read failed AND this replica has never seen today's ledger — the
   *  committed set is unknowable, and consumers must fail closed on anything that
   *  needs to tell "fresh find" apart from "committed play". */
  committed_known: boolean;
};

/** Today's ledger with an explicit "could we actually read it?" signal.
 *
 *  WHY (P0 — "OPEN regressed to Watch"): the old read swallowed any DB failure
 *  into an empty array, indistinguishable from "no plays committed today". One
 *  transient blip made every committed play VANISH from the board payload for a
 *  cache window — and because committed tickers usually still rank in the scan's
 *  fresh finds, the member saw their OPEN position card demoted to a fresh-find
 *  watch card. Commit is a one-way door: a committed row may never be re-presented
 *  as an uncommitted find, so a failed read (a) falls back to this replica's
 *  last-good same-session snapshot (slightly stale marks beat vanished positions;
 *  the 5s board cache already tolerates that staleness), and (b) when no snapshot
 *  exists, says so via committed_known=false instead of lying "empty". */
export async function readZeroDteLedgerChecked(): Promise<ZeroDteLedgerRead> {
  if (!dbConfigured()) return { rows: [], committed_known: true };
  const today = todayEt();
  try {
    const rows = await fetchZeroDteSetupLog(today);
    lastGoodLedger = { date: today, rows };
    return { rows, committed_known: true };
  } catch {
    if (lastGoodLedger?.date === today) return { rows: lastGoodLedger.rows, committed_known: true };
    return { rows: [], committed_known: false };
  }
}

/** Today's ledger for the board's "flagged today" lane (empty without a database).
 *  Failure degrades to the last-good same-session snapshot (see the checked read). */
export async function readZeroDteLedger(): Promise<ZeroDteSetupLogRow[]> {
  return (await readZeroDteLedgerChecked()).rows;
}

/** Test-only: reset the last-good ledger latch between cases. */
export function _resetZeroDteLedgerLatchForTest(): void {
  lastGoodLedger = null;
}

/**
 * Refresh every live play's lifecycle state from one batched quote snapshot:
 * latch peak/trough of the mark, derive OPEN/HOLD/TRIM/CLOSED (sticky stop via
 * trough), persist, and return the rows with fresh values for the payload.
 * Already-CLOSED rows are left untouched. Best-effort throughout.
 */
export async function syncLedgerLiveState(rows: ZeroDteSetupLogRow[]): Promise<ZeroDteSetupLogRow[]> {
  const live = rows.filter((r) => r.status !== "CLOSED");
  if (live.length === 0) return rows;
  const occs = live
    .map((r) => (typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null))
    .filter((o): o is string => Boolean(o));
  const snaps = occs.length
    ? await within(
        fetchOptionsUnifiedSnapshot(occs).catch(
          () => new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>()
        ),
        2_500
      )
    : new Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>();
  if (!snaps) return rows;
  const { hour, minute } = etNowParts();
  const nowEtMinutes = hour * 60 + minute;

  // G-5 input: stop transitions observed THIS pass (a row flipping to CLOSED/
  // stopped) get their timestamp recorded to the shared governor state — Postgres
  // has no stop-time column, and the 20-minute re-entry lock needs one.
  const stopEvents: Array<{ ticker: string; direction: "long" | "short"; at_ms: number }> = [];

  const updated = await Promise.all(
    rows.map(async (r) => {
      // CLOSED is terminal; every other row gets a state pass — rows with no plan/
      // entry still time-stop at 15:30 (data quality never exempts the clock).
      if (r.status === "CLOSED") return r;
      const occ = typeof r.plan_json?.occ === "string" ? (r.plan_json.occ as string) : null;
      const mark = occ ? (snaps.get(occ)?.mark ?? null) : null;
      // LATCH ONLY WHAT IS ACTUALLY KNOWN — an absent premium must stay absent.
      //
      // The trough used to read
      //   Math.min(r.trough_premium ?? (r.entry_premium ?? Number.MAX_VALUE), mark ?? Number.MAX_VALUE)
      // so a row with no prior trough, no entry premium and no fresh mark latched
      // Number.MAX_VALUE — 1.7976931348623157e308 — and persisted/served it as `trough_premium`.
      // Iron condors are the population that hits it: a credit structure carries no single entry
      // premium, so the first `??` falls through, and any tick without a quote supplies the second.
      //
      // Nothing downstream caught it because `Number.isFinite(1.79e308)` is TRUE: the response
      // sanitizer, the audit suite's `scanFinite` sweep and the malformed-value scan all pass it
      // through as a perfectly good number. Only reading the payload finds it.
      //
      // `derivePlayStatus` already takes `peak: number | null` and `trough: number | null`, so the
      // sentinel bought nothing in the first place — null was always the supported way to say
      // "not known yet".
      //
      // The peak had the same shape with the opposite failure: `?? 0` made an unknown peak read as
      // ZERO, which understates rather than absurdly overstates, so it was invisible. Both now
      // latch across the finite candidates and stay null when there are none.
      // ONE latch, shared with the 1s marks lane (marks-math.advancePlayLatch). This used to be an
      // inline Math.min/Math.max pair with a Number.MAX_VALUE sentinel, which is how the two lanes
      // came to disagree — see latchPremiumBounds for the full account.
      const { peak, trough } = latchPremiumBounds(
        r.peak_premium ?? r.entry_premium,
        r.trough_premium ?? r.entry_premium,
        mark
      );
      // Exit engine FIRST with plan-stop deferred — a latched trough at −50% must not
      // skip the ratchet floor when peak had armed breakeven (FINDINGS 2026-08-04).
      const preStop = derivePlayStatus({
        entryPremium: r.entry_premium,
        mark: mark ?? r.last_mark,
        peak,
        trough,
        nowEtMinutes,
        deferPlanStop: true,
      });
      const exit =
        preStop.status !== "CLOSED"
          ? await evaluateLedgerRowExit(r, { syncMark: mark, status: preStop.status }, {
              // Persist a newly-armed trim_scale tranche so the NEXT sync pass sees it
              // via row.trims_taken. A no-op while ZERODTE_TRIM_BANK_LIVE is off.
              onTrimBank: async (trimsTaken) => {
                if (!dbConfigured()) return;
                await updateZeroDteLiveState(r.session_date, r.ticker, {
                  status: preStop.status,
                  mark,
                  trimsTaken,
                }).catch(() => {});
                void import("./discord-trade-notify")
                  .then(({ notifyZeroDteTradeTrim }) =>
                    notifyZeroDteTradeTrim({ ...r, trims_taken: trimsTaken }, trimsTaken, mark)
                  )
                  .catch((err) => {
                    console.warn(`[zerodte-discord] trim notify failed for ${r.ticker}:`, err);
                  });
              },
            }).catch(() => null)
          : null;
      const state =
        exit == null
          ? derivePlayStatus({
              entryPremium: r.entry_premium,
              mark: mark ?? r.last_mark,
              peak,
              trough,
              nowEtMinutes,
            })
          : preStop;
      const status = exit ? ("CLOSED" as const) : state.status;
      const finalMark = exit ? exit.mark : mark;
      // Governor stop accounting: a plan-stop exit IS a stop wherever it was
      // detected (latch or fresher lane mark). Ratchet/thesis/flat exits are
      // deliberately NOT counted — the governor's halt counts busted plans, and a
      // breakeven-floor scratch or a banked runner is not one.
      if (
        (state.status === "CLOSED" && state.closed_reason === "stopped") ||
        exit?.decision.reason === "plan_stop"
      ) {
        stopEvents.push({ ticker: r.ticker, direction: r.direction, at_ms: Date.now() });
      }
      if (dbConfigured()) {
        await updateZeroDteLiveState(r.session_date, r.ticker, { status, mark: finalMark }).catch(() => {});
      }
      // Widen the returned latches with the exit mark too (the lane mark can sit
      // outside the snapshot mark) — mirrors the DB write's GREATEST/LEAST.
      // Null-safe widening. `Math.max(null, x)` coerces null to 0, so the old form would have
      // silently latched a 0 peak the moment `peak` became nullable — the same class of bug one
      // level down.
      const peakOut =
        finalMark != null ? (peak != null ? Math.max(peak, finalMark) : finalMark) : peak;
      const troughOut =
        finalMark != null ? (trough != null ? Math.min(trough, finalMark) : finalMark) : trough;
      const nextRow = {
        ...r,
        status,
        last_mark: finalMark ?? r.last_mark,
        peak_premium: peakOut,
        trough_premium: troughOut,
      };
      if (r.status !== "CLOSED" && status === "CLOSED") {
        void import("./discord-trade-notify")
          .then(({ notifyZeroDteTradeClose }) =>
            notifyZeroDteTradeClose({ ...nextRow, trims_taken: r.trims_taken ?? 0 }, finalMark)
          )
          .catch((err) => {
            console.warn(`[zerodte-discord] close notify failed for ${r.ticker}:`, err);
          });
      } else if (
        r.status !== "TRIM" &&
        status === "TRIM" &&
        preStop.status === "TRIM"
      ) {
        void import("./discord-trade-notify")
          .then(({ notifyZeroDteTradeTrimLatch }) => notifyZeroDteTradeTrimLatch(r, finalMark))
          .catch((err) => {
            console.warn(`[zerodte-discord] trim-latch notify failed for ${r.ticker}:`, err);
          });
      }
      return nextRow;
    })
  );
  if (stopEvents.length > 0) {
    // Best-effort (first-write-wins per ticker inside recordGovernorStops): a Redis
    // failure only softens the timed lock — the ledger stop still counts to the halt.
    void recordGovernorStops(todayEt(), stopEvents).catch(() => {});
  }
  return updated;
}

// ── BlackOut Intelligence — shared desk awareness ─────────────────────────────────
// The rest of the ecosystem (Largo's ambient live feed, its get_zerodte_plays tool,
// any future surface) consumes the SAME deterministic intelligence the board shows
// members — one brain, many mouths. No LLM in this path.

/** Compact ledger snapshot for ambient awareness. Used in Largo's live feed on EVERY
 *  question (captureLargoLiveFeed in largo-live-feed.ts), unconditionally — unlike
 *  get_zerodte_plays, which Largo only calls when it decides the question needs it.
 *  That makes this the code path a member's answer is actually built from most of
 *  the time for "how's my NVDA play doing" style questions.
 *
 *  P1 FIX (found during the 0DTE Command entry-gate audit, see FINDINGS.md): this
 *  used to read readZeroDteLedger() RAW with no live-quote sync, trusting the
 *  status/last_mark exactly as the ~2-min grid-warm cron last wrote them to
 *  Postgres. That is precisely the "0DTE board / Largo / BIE used parallel scan
 *  paths" bug class already found+fixed for the get_zerodte_plays TOOL path and
 *  BIE composers (both now funnel through zeroDtePlaysForLargo() /
 *  getZeroDteBoardPayload() in zerodte-service.ts, which DOES call
 *  syncLedgerLiveState() before mapping ledger rows) — that fix never touched this
 *  function, so the ambient feed could tell Largo a play was still "OPEN" at a
 *  stale mark for up to ~2 minutes (or longer if a cron tick was missed) after it
 *  had actually stopped out or doubled, and Largo's system prompt treats this block
 *  as "authoritative source for this turn" without necessarily calling the fresher
 *  tool. Now calls the SAME syncLedgerLiveState() the canonical board payload uses,
 *  so this reflects the live quote, not the last cron write. Deliberately still a
 *  direct ledger read (not routed through getZeroDteBoardPayload()) rather than the
 *  heavier full-board rebuild: this ambient block only ever surfaces already-
 *  flagged ledger rows (never `setups`/`fresh_finds`), and importing
 *  zerodte-service.ts here would be circular (it imports FROM this module). */

// The two empty states live in a pure leaf module so `get_zerodte_plays` (built from the board
// payload, in platform/zerodte-service.ts) shares them rather than inventing a second meaning for
// the same silence. Re-exported here because this is where callers and tests already look.
import { zeroDteFeedEmptyEnvelope } from "./feed-envelope";
export { zeroDteFeedEmptyEnvelope };

export async function zeroDtePlaysFeed(): Promise<Record<string, unknown>> {
  // ABSENCE IS NOT EMPTINESS (Largo product contract C3).
  //
  // This used to call readZeroDteLedger() — the wrapper that DISCARDS `committed_known` —
  // and then collapse two completely different states into one `available: false`:
  //   (a) the scanner ran and nothing cleared the commit gates (a MEASURED result), and
  //   (b) the ledger read failed and this replica has never seen today's rows (an UNKNOWN).
  // `readZeroDteLedgerChecked` already computes exactly the fact that separates them, and its
  // own doc comment says it exists to say so "instead of lying 'empty'". The fact was there;
  // this reader simply was not wired to it.
  //
  // Both halves matter, and (b) is the money-relevant one. Largo's system prompt treats this
  // block as the AUTHORITATIVE source for the turn, so during a ledger outage a member asking
  // "any 0DTE plays today?" was told a confident "no plays flagged this session" when the
  // truth is "we cannot see the ledger". And on a healthy quiet session — pre-market, or a
  // session the fail-closed firewall held entirely — `available: false` reads as "this tool is
  // broken" and invites the model to fall back to guessing, while the member's own desk is
  // simultaneously showing `available: true`. Measured live 2026-08-21 pre-market: board
  // available=true / upstream_ok=true / 0 setups / 0 ledger, feed available=false. Same fact,
  // two answers.
  const read = await readZeroDteLedgerChecked();
  const session_date = todayEt();
  if (read.rows.length === 0) return zeroDteFeedEmptyEnvelope(read.committed_known, session_date);
  const rows = await syncLedgerLiveState(read.rows).catch(() => read.rows);
  return {
    available: true,
    session_date,
    plays: rows.map((r) => ({
      ticker: r.ticker,
      contract: `${r.top_strike ?? "?"}${r.direction === "long" ? "c" : "p"}`,
      status: r.status ?? "HOLD",
      entry_premium: r.entry_premium,
      last_mark: r.last_mark,
      peak_score: r.score_max,
      spike: r.spike,
      first_flagged_et: r.first_flagged_at,
      result: r.plan_outcome
        ? `${r.plan_outcome}${r.plan_pnl_pct != null ? ` ${r.plan_pnl_pct > 0 ? "+" : ""}${r.plan_pnl_pct}%` : ""}`
        : null,
    })),
  };
}

/** @deprecated Import from `@/lib/platform/zerodte-service` — single board cache lane. */
export { zeroDtePlaysForLargo } from "@/lib/platform/zerodte-service";

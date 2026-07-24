/**
 * 0DTE CONFLUENCE — the "take fewer, higher-agreement trades" read (calibration-first).
 *
 * WHY THIS EXISTS (docs/audit/0DTE-RESEARCH.md): no single 0DTE signal has a durable edge — a
 * geometry sweep and a discovery-window A/B both landed near breakeven. What DID produce edge, across
 * 25 sessions, was CONFLUENCE: requiring independent confirmations to AGREE. Measured, at a post-open
 * entry, the expectancy laddered with the number of confirmations:
 *   0 confirmations → −12.5% EV | 1 → 0% | 2 (VWAP-side + market-aligned) → +15.9% EV (41% win, n=22).
 * And it resolved the geometry paradox — the wide −50/+100 target is BEST for the confluent subset and
 * WORST for the noise, because confluence selects trend-CONTINUATION trades that need room to run.
 *
 * The live scanner already computes all three confirmation inputs during enrichment; it just scores
 * them ADDITIVELY, so a single strong factor can drag a low-agreement setup onto the board. This
 * module reads those existing fields and produces a single confluence read + tier so the board can
 * distinguish a triple-confirmed A+ setup from a one-legged one.
 *
 * GATING (2026-07-24, Change 1): the `confirmations` count (VWAP-side + market-aligned, the exact E3
 * axis) is now a real commit input via G-12 (gates.ts) — the additive score let a single loud premium
 * tier (+40) clear the 65 floor with ZERO confirmations, and the 0-confirmation bucket is the −12.5% EV
 * loser. G-12 requires ≥ ZERODTE_CONFLUENCE_MIN confirmations (default 1: block only the measured-losing
 * 0-conf) and a higher floor inside the early window. The `score`/`tier` remain calibration-first display
 * (the triple-tier's extra edge over double is still for the graded ledger to confirm before IT gates).
 *
 * PURE: reads already-attached setup fields (intraday VWAP read, market_aligned) + the current ET
 * minute-of-day. No IO. Deterministic given (setup, nowEtMinutes).
 */

import type { EnrichedZeroDteSetup } from "./board";

/** Past this ET minute the opening chop has resolved — the favorable entry window per the research
 *  (entries at 9:45 ran −12% EV; the edge shows up after the first ~30–90 min). Exported so a backtest
 *  can sweep it. */
export const POST_OPEN_ET_MINUTES = 10 * 60; // 10:00 ET
/** No NEW 0DTE entries in the last hour (mirrors the board's 15:00 new-play cutoff). */
export const ENTRY_CUTOFF_ET_MINUTES = 15 * 60; // 15:00 ET
/** End of the measured-NEGATIVE early entry window [10:00, 10:45) ET. E2 (25 sessions,
 *  docs/audit/0DTE-RESEARCH.md) put a fixed entry at 10:00 at −7.8% EV and 10:30 at −9.1%; the
 *  first positive cell is 11:00 (+1.5%). The board still UNLOCKS at 10:00 (G-2) — blocking the
 *  whole morning would empty the board — but a commit inside this window is the worst-timed one,
 *  so G-12 demands a HIGHER confluence floor here (Change 2) and the size chip halves. Exported
 *  so a backtest can sweep the boundary. */
export const EARLY_ENTRY_WINDOW_END_ET_MINUTES = 10 * 60 + 45; // 10:45 ET

export type ZeroDteConfluence = {
  /** 0–3: how many independent confirmations agree with the setup's direction (timing+VWAP+market). */
  score: number;
  /** The RESEARCH axis (E3): VWAP-side + market-aligned only, 0–2 — the count G-12 gates on. Held
   *  at a fixed post-open time, 0→−12.5% EV, 1→0%, 2→+15.9% (docs/audit/0DTE-RESEARCH.md). Distinct
   *  from `score`, which also folds in the timing leg (≈always true past the 10:00 unlock, so it
   *  can't distinguish a 0-confirmation setup — hence a dedicated count for gating). */
  confirmations: number;
  /** Entered past the opening chop and before the new-play cutoff (favorable window). */
  timing_ok: boolean;
  /** Inside the measured-negative early window [10:00, 10:45) ET — G-12 raises the floor + size halves. */
  early_window: boolean;
  /** Price is on the trend side of session VWAP for the setup's direction. */
  vwap_ok: boolean;
  /** Setup direction agrees with the live SPY/market tape (G-1 alignment). */
  market_ok: boolean;
  /** triple = all three agree (A+), double = VWAP+market (the +15.9% EV bucket), weak = ≤1. */
  tier: "triple" | "double" | "weak";
  /** Human label for the card/intel line. */
  label: string;
};

/** Compute the confluence read for one enriched setup at the current ET minute-of-day. */
export function computeConfluence(setup: EnrichedZeroDteSetup, nowEtMinutes: number): ZeroDteConfluence {
  const timing_ok = nowEtMinutes >= POST_OPEN_ET_MINUTES && nowEtMinutes < ENTRY_CUTOFF_ET_MINUTES;

  const vwap = setup.intraday?.vwap ?? null;
  const last = setup.intraday?.last ?? null;
  const vwap_ok =
    vwap != null && last != null && Number.isFinite(vwap) && Number.isFinite(last)
      ? setup.direction === "long"
        ? last > vwap
        : last < vwap
      : false;

  // market_aligned is already "direction vs SPY tape" (null when flat/unknown → not a confirmation).
  const market_ok = setup.market_aligned === true;

  // The E3-measured axis: VWAP-side + market agreement (the count that laddered 0→1→2 into EV).
  const confirmations = (vwap_ok ? 1 : 0) + (market_ok ? 1 : 0);
  const early_window =
    nowEtMinutes >= POST_OPEN_ET_MINUTES && nowEtMinutes < EARLY_ENTRY_WINDOW_END_ET_MINUTES;

  const score = (timing_ok ? 1 : 0) + confirmations;
  // The measured edge is the VWAP+market agreement (the +15.9% EV bucket); timing gilds it to A+.
  const tier: ZeroDteConfluence["tier"] =
    vwap_ok && market_ok && timing_ok ? "triple" : vwap_ok && market_ok ? "double" : "weak";

  const legs = [timing_ok ? "timing" : null, vwap_ok ? "VWAP" : null, market_ok ? "market" : null].filter(Boolean);
  const label =
    tier === "triple"
      ? `triple-confirmed (${legs.join("+")})`
      : tier === "double"
        ? "VWAP+market confirmed"
        : legs.length
          ? `weak (${legs.join("+")} only)`
          : "unconfirmed";

  return { score, confirmations, timing_ok, early_window, vwap_ok, market_ok, tier, label };
}

/**
 * Attach the confluence read to each enriched setup (evidence only — never gates here). Mutates in
 * place. Call AFTER the intraday-edge pass (which populates `intraday` + `market_aligned`).
 */
export function attachConfluence(setups: EnrichedZeroDteSetup[], nowEtMinutes: number): void {
  for (const s of setups) s.confluence = computeConfluence(s, nowEtMinutes);
}

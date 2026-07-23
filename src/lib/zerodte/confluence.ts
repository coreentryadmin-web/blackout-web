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
 * CALIBRATION-FIRST: EVIDENCE ONLY. It attaches a read; it does NOT move the score or gate the board.
 * Whether the triple-confirmed tier actually wins more is for the graded ledger to confirm (calibration.ts)
 * before it ever gates — the same discipline as G-4/G-6 and the flow-accumulation context.
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

export type ZeroDteConfluence = {
  /** 0–3: how many independent confirmations agree with the setup's direction. */
  score: number;
  /** Entered past the opening chop and before the new-play cutoff (favorable window). */
  timing_ok: boolean;
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

  const score = (timing_ok ? 1 : 0) + (vwap_ok ? 1 : 0) + (market_ok ? 1 : 0);
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

  return { score, timing_ok, vwap_ok, market_ok, tier, label };
}

/**
 * Attach the confluence read to each enriched setup (evidence only — never gates here). Mutates in
 * place. Call AFTER the intraday-edge pass (which populates `intraday` + `market_aligned`).
 */
export function attachConfluence(setups: EnrichedZeroDteSetup[], nowEtMinutes: number): void {
  for (const s of setups) s.confluence = computeConfluence(s, nowEtMinutes);
}

/**
 * BANGER SCALE-OUT GRADE (pure) — the basis-correct measurement for the whole-market banger population.
 *
 * The banger engine (single-name/sector-ETF breakouts, cheap OTM weekly calls) is the proven +EV
 * positive-skew lever, but its edge lives in a MULTI-DAY scale-out over the OPTION's own bars — a
 * structurally different basis from the index grinder's same-day −50/+100 (`zerodte_setup_log`). Forcing
 * it through that same-day grader would mis-measure it. This module grades a banger row on the CORRECT
 * basis, using the SAME production exit rule (`gradeScaleOut` / `SCALE_OUT_RULES`) as the backtest so
 * research and the live ledger can never drift.
 *
 * PURE: the caller does the IO (parse the stored options_play → OCC → fetch forward option bars) and
 * hands the entry premium + bars here. The grade is EVIDENCE pinned into the row's entry_context; it is
 * NOT gating and NOT the member-facing same-day record. `ungradeable` (thin/expired OTM weekly with no
 * forward bars) is reported SEPARATELY and never imputed — the survivorship guard that keeps the headline
 * realized rate honest.
 */
import { gradeScaleOut, type ScaleOutBar } from "./scale-out";

export type BangerScaleOutGrade = {
  /** Realized multiple under the production scale-out (partial @2×, trail runner off peak, hard stop). */
  scale_out_realized_mult: number | null;
  /** Hold-to-last-bar multiple — the naive alternative the scale-out edge is measured AGAINST. */
  hold_mult: number | null;
  /** True when the contract had no usable forward bars — recorded separately, excluded from any rate,
   *  NEVER imputed to a multiple (the thin-OTM-weekly survivorship guard). */
  ungradeable: boolean;
  reason?: string;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Grade a banger's forward OPTION bars on the scale-out basis. `entryPremium` is the pinned ledger
 * entry; `bars` are the contract's forward bars (any resolution) from entry onward. Fail-soft: bad
 * entry or no usable bars → `ungradeable`, never a fabricated multiple.
 */
export function gradeBangerScaleOut(entryPremium: number | null, bars: ScaleOutBar[]): BangerScaleOutGrade {
  if (entryPremium == null || !(entryPremium > 0)) {
    return { scale_out_realized_mult: null, hold_mult: null, ungradeable: true, reason: "no_entry_premium" };
  }
  const usable = (bars ?? []).filter(
    (b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c > 0
  );
  if (usable.length === 0) {
    return { scale_out_realized_mult: null, hold_mult: null, ungradeable: true, reason: "no_forward_bars" };
  }
  const sorted = [...usable].sort((a, b) => a.t - b.t);
  return {
    scale_out_realized_mult: round2(gradeScaleOut(sorted, entryPremium)),
    hold_mult: round2((sorted[sorted.length - 1]!.c) / entryPremium),
    ungradeable: false,
  };
}

/**
 * OCC option symbol for a banger contract — the key the forward-bar fetch uses. Pure; returns null on
 * malformed inputs (so the caller records `ungradeable` rather than fetching a garbage symbol).
 * Format: `O:{TICKER}{YYMMDD}{C|P}{strike×1000, 8-padded}`.
 */
export function bangerOccSymbol(
  ticker: string,
  strike: number,
  expiryYmd: string,
  side: "call" | "put"
): string | null {
  if (!ticker || !(strike > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiryYmd)) return null;
  const yy = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  return `O:${ticker.toUpperCase()}${yy}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

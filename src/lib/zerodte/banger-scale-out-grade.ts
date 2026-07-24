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

/** Calendar date (YYYY-MM-DD) of a bar's epoch-ms timestamp in US Eastern (exchange) time —
 *  the same convention the rest of the platform uses to date a Polygon daily bar
 *  (spx-session.ts etYmdFromMs). Pure (Intl only), so this module keeps its no-server-only
 *  import graph. */
function etYmdFromMs(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Grade a banger's forward OPTION bars on the scale-out basis. `entryPremium` is the pinned ledger
 * entry; `bars` are the contract's forward bars (any resolution) from entry onward; `expiryYmd` is
 * the contract's expiry (YYYY-MM-DD) — the baseline `hold_mult` is defined as hold-to-EXPIRY, so it
 * can only be measured once the forward series actually reaches the expiry session. Fail-soft: bad
 * entry, no usable bars, or a series truncated before expiry → `ungradeable`, never a fabricated
 * multiple.
 */
export function gradeBangerScaleOut(
  entryPremium: number | null,
  bars: ScaleOutBar[],
  expiryYmd?: string | null
): BangerScaleOutGrade {
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
  // hold_mult is hold-to-EXPIRY (the defined baseline, which decays toward ~0 for an OTM weekly).
  // When the forward series is truncated before expiry (thin option that stopped printing, a short
  // Polygon page), the last available bar is an intraday/mid-life close — crediting it as the expiry
  // close reads an artificially HIGH hold_mult (a fabricated "still worth X at expiry"). A null is
  // honest; grade the row ungradeable instead of inventing a non-expiry hold value.
  if (expiryYmd && etYmdFromMs(sorted[sorted.length - 1]!.t) < expiryYmd) {
    return { scale_out_realized_mult: null, hold_mult: null, ungradeable: true, reason: "forward_bars_truncated" };
  }
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

/** The parsed-contract shape the resolver consumes — structurally the nighthawk parser's
 *  `ParsedOptionsContract`. Declared INLINE (not imported) so this pure lib module stays free of any
 *  nighthawk-feature import: `option-chain-prompt.ts` drags in Polygon/UW/WS IO modules, which would
 *  pollute this module's import graph and its unit test. The caller (the outcomes cron) does the parse
 *  and hands the result in. */
export type ParsedContractInput = { strike: number; side: "call" | "put" | null; expiryYmd: string | null };

/** Resolving a published play into the inputs the forward-bar fetch + `gradeBangerScaleOut` need.
 *  Three outcomes: NOT a scale_out banger (caller skips silently); IS a banger but the contract can't
 *  be resolved (caller pins an `ungradeable` grade with the reason — never fetches a garbage symbol);
 *  or OK with the OCC + entry premium + expiry the caller fetches against. */
export type BangerGradeRequest = {
  occ: string;
  entryPremium: number;
  expiryYmd: string;
  ticker: string;
  side: "call" | "put";
  strike: number;
};
export type BangerGradeResolution =
  | { kind: "not_banger" }
  | { kind: "ungradeable"; reason: string }
  | { kind: "ok"; request: BangerGradeRequest };

/** PURE: decide how to grade a play's scale-out. Only `exit_style === "scale_out"` plays are bangers;
 *  everything else is `not_banger` (the caller must not touch it). A banger with a missing entry
 *  premium or an unresolvable contract is `ungradeable` — reported, never imputed to a multiple
 *  (the survivorship guard that keeps the realized rate honest). */
export function resolveBangerGradeRequest(input: {
  ticker: string;
  exit_style?: string | null;
  entry_premium?: number | null;
  contract: ParsedContractInput | null;
}): BangerGradeResolution {
  if (input.exit_style !== "scale_out") return { kind: "not_banger" };
  const ep = input.entry_premium;
  if (ep == null || !(ep > 0)) return { kind: "ungradeable", reason: "no_entry_premium" };
  const c = input.contract;
  if (!c) return { kind: "ungradeable", reason: "unparseable_contract" };
  if (c.side == null) return { kind: "ungradeable", reason: "no_side" };
  if (c.expiryYmd == null) return { kind: "ungradeable", reason: "no_expiry" };
  const occ = bangerOccSymbol(input.ticker, c.strike, c.expiryYmd, c.side);
  if (!occ) return { kind: "ungradeable", reason: "bad_occ" };
  return {
    kind: "ok",
    request: { occ, entryPremium: ep, expiryYmd: c.expiryYmd, ticker: input.ticker.toUpperCase(), side: c.side, strike: c.strike },
  };
}

/** PURE: map forward option aggregate bars (Polygon AggBar shape — `t` is OPTIONAL there) onto the
 *  `ScaleOutBar` the grader consumes, dropping any bar without a finite timestamp so a malformed row
 *  can never scramble the chronological sort in `gradeBangerScaleOut`. */
export function optionAggBarsToScaleOut(
  bars: ReadonlyArray<{ t?: number; h: number; l: number; c: number }>
): ScaleOutBar[] {
  const out: ScaleOutBar[] = [];
  for (const b of bars ?? []) {
    if (b == null || !Number.isFinite(b.t)) continue;
    out.push({ t: b.t as number, h: b.h, l: b.l, c: b.c });
  }
  return out;
}

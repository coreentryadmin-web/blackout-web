// Pure math for the 0DTE live-marks lane (B-9) — dependency-free leaf (only
// plan.ts constants/state machine) so the board service, the SSE lane, and the
// client can all share ONE derivation of every displayed number without pulling
// the impure lane (db/providers/ws) into their import graphs or tests.
//
// The correctness rules live here as CODE, not advice:
//  - resolveZeroDteMark: mid is the mark; last-trade only as a FLAGGED fallback;
//    a prior-session close is never a live mark.
//  - pinnedLivePnlPct: the ONE P&L formula, always against the PINNED ledger
//    entry premium.
//  - closedStopReason: a stopped play's result is the stop P&L (matches the
//    post-session grader), never a frozen last_mark.
//  - advancePlayLatch: the same latch + derivePlayStatus state machine the
//    scanner sync uses, as a pure function of (prior latch, mark, clock).

import { derivePlayStatus, PLAN_RULES, type PlayStatus } from "./plan";

/** Hard cap on contracts in the live lane — open ledger plays only, never a chain.
 *  Raised 16→100 (2026-07-29) to match the uncapped open-play desk: marks must track
 *  every committed OCC, not silently drop plays past the old 16-slot lane. */
export const ZERODTE_LIVE_CONTRACT_CAP = 100;

/** A mark older than this must be rendered as STALE by every consumer (ms). */
export const ZERODTE_MARK_STALE_MS = 5_000;

/** Legacy plays poll stock quotes via REST every 5s; 30s without an update = stale. */
export const LEGACY_QUOTE_STALE_MS = 30_000;

export type ZeroDteMarkSource = "mid" | "last" | "none";

/** Mid of bid/ask — IDENTICAL guard to the chain/WS midOf (ask>0 = a real quote,
 *  bid may be 0 for deep-OTM). */
export function zeroDteMidOf(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && ask > 0 && bid >= 0) {
    return Number(((bid + ask) / 2).toFixed(4));
  }
  return null;
}

/**
 * Resolve the DISPLAY mark with provenance: mid when a two-sided quote exists,
 * else the last trade FLAGGED as such, else none. Deliberately excludes the
 * unified snapshot's dayClose tier — a prior-session close rendered as a live
 * mark is the exact wrong-number class this lane exists to kill (D-2 in
 * docs/audit/ZERODTE-DATA-PATH-AUDIT.md).
 */
export function resolveZeroDteMark(
  bid: number | null,
  ask: number | null,
  last: number | null
): { mark: number | null; source: ZeroDteMarkSource } {
  const mid = zeroDteMidOf(bid, ask);
  if (mid != null && mid > 0) return { mark: mid, source: "mid" };
  if (last != null && last > 0) return { mark: last, source: "last" };
  return { mark: null, source: "none" };
}

/**
 * THE P&L derivation — premium P&L % of `mark` against the PINNED entry premium.
 * Single source of truth: zerodte-service's board rows, the SSE lane, and any
 * future consumer must import this, never re-implement it (pre-B-9 the board had
 * this exact formula duplicated privately in zerodte-service.ts). Rounding
 * matches derivePlayStatus (plan.ts): 2dp via ×10000/100.
 */
export function pinnedLivePnlPct(entryPremium: number | null, mark: number | null): number | null {
  if (entryPremium == null || entryPremium <= 0 || mark == null) return null;
  return Math.round(((mark - entryPremium) / entryPremium) * 10000) / 100;
}

/**
 * SELLER-framed premium P&L for a CREDIT structure (the iron condor) — the mirror of
 * pinnedLivePnlPct. A condor is SOLD for the credit (`entryCredit`) at entry and BOUGHT BACK at
 * the current `mark`, so its return is (entry − mark)/entry: a DECAYING mark (mark ↓ toward 0) is
 * a POSITIVE return (the credit kept), and a mark that BLOWS OUT above the credit is the defined
 * loss. This is the exact INVERSE of the long-premium formula — applying pinnedLivePnlPct to a
 * credit structure records a winning (decaying) condor as a large NEGATIVE (a +76% winner stored
 * as −76%; FINDINGS 2026-07-26). Same guards + 2dp rounding as pinnedLivePnlPct so the two lanes
 * are directly comparable. Null-safe on a missing entry/mark (quote-only or unmarked condor row).
 */
export function condorSellerPnlPct(entryCredit: number | null, mark: number | null): number | null {
  if (entryCredit == null || entryCredit <= 0 || mark == null) return null;
  return Math.round(((entryCredit - mark) / entryCredit) * 10000) / 100;
}

/**
 * THE structure-aware live-P&L branch — seller-framed for a credit condor, long-framed otherwise —
 * so the board/live lanes branch on structure in ONE place and no consumer re-implements the flip
 * (the Wave-2 render adapter used to invert at DISPLAY, which risked a double-invert once the source
 * was corrected; this is the single source instead). Directional rows are byte-identical to
 * pinnedLivePnlPct.
 */
export function livePnlPctFor(
  isCondor: boolean,
  entryPremium: number | null,
  mark: number | null
): number | null {
  return isCondor ? condorSellerPnlPct(entryPremium, mark) : pinnedLivePnlPct(entryPremium, mark);
}

// ── WS-10: executable-side P&L lanes (bid/ask, not mid) ────────────────────────────
// WHY THIS EXISTS. `pinnedLivePnlPct` above marks a play on the MID. But a long 0DTE
// option is BOUGHT near the ASK and SOLD near the BID — mid marks BOTH the entry and the
// exit at a price no member could actually transact, so a mid-based return systematically
// UNDERSTATES the execution tax (acute for 0DTE, where spreads blow out into the stop as
// the option goes worthless). The record then answers "did the MIDPOINT touch target/stop"
// — not "could a member have EXITED there" — which lets calibration graduate strategies
// that only win at mid. WS-10 makes the OFFICIAL simulated P&L (calibration + the public
// record) executable-side honest. Three lanes are maintained:
//   (a) MIDPOINT   — the functions above; the monitoring/display mark. KEPT AS-IS.
//   (b) CONSERVATIVE EXECUTABLE — entry basis = ASK, exit = BID (a marketable-limit model).
//       This is the OFFICIAL lane calibration/record grade on.
//   (c) BROKER     — reserved for a future real-fill integration (shape only; unpopulated).
// Directional 0DTE plays are LONG PREMIUM in BOTH directions ("long" = a bought call,
// "short" = a bought put), so both BUY at the ask and SELL at the bid; the entry/exit sides
// below are the same for either direction. (The only credit/short-premium structure on the
// platform is the iron condor, which is graded on its OWN 4-leg path and is out of scope
// for this lane — see gradePlanExecutableFromBars' doc in plan.ts.)

/** Conservative half-spread as a fraction of MID, used when a row carries no two-sided
 *  entry quote to measure the real spread from (legacy rows, or a one-sided book at flag).
 *  5% of mid ≈ a 10%-of-mid round-trip spread — a deliberately conservative floor for a
 *  0DTE contract (the platform already flags a book illiquid above a 15%-of-mark spread,
 *  plan.ts). A modeled tax is honest ONLY if it never flatters the fill, so the fallback
 *  errs wide, never tight. */
export const ZERODTE_DEFAULT_HALF_SPREAD_FRAC = 0.05;

/** Half-spread as a fraction of mid from a two-sided quote: (ask − bid) / (ask + bid)
 *  ( = (spread/2) / mid ). Same validity guard as zeroDteMidOf (ask>0, bid>=0, ask>=bid),
 *  so a crossed/locked/one-sided book returns null and the caller falls back to the default
 *  frac rather than modeling a negative or zero tax. */
export function zeroDteHalfSpreadFrac(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && ask > 0 && bid >= 0 && ask >= bid) {
    // denom = ask + bid is provably > 0 here (ask > 0 excludes zero/NaN, bid >= 0), so no
    // divide-by-zero guard is needed — a redundant `denom <= 0` check was flagged useless by CodeQL.
    return (ask - bid) / (ask + bid);
  }
  return null;
}

/** Executable ENTRY basis for a long-premium play: the ASK you pay to open. Modeled from
 *  a mid + half-spread frac as mid×(1+f). Null-guarded on a bad mid. */
export function zeroDteExecutableEntry(mid: number | null, halfSpreadFrac: number): number | null {
  if (mid == null || mid <= 0 || !(halfSpreadFrac >= 0)) return null;
  return mid * (1 + halfSpreadFrac);
}

/** Executable EXIT mark for a long-premium play: the BID you sell into to close. Modeled
 *  from a mid + half-spread frac as mid×(1−f). Floored at 0 (a bid never goes negative —
 *  a >100% half-spread frac can't manufacture a negative exit price). */
export function zeroDteExecutableExit(mid: number | null, halfSpreadFrac: number): number | null {
  if (mid == null || mid < 0 || !(halfSpreadFrac >= 0)) return null;
  return Math.max(0, mid * (1 - halfSpreadFrac));
}

/** THE executable P&L derivation — (exit BID − entry ASK) / entry ASK. The conservative-
 *  executable lane's return, the OFFICIAL simulated P&L calibration and the public record
 *  grade on. Rounds 2dp like pinnedLivePnlPct so the two lanes are directly comparable. */
export function executablePnlPct(entryAsk: number | null, exitBid: number | null): number | null {
  if (entryAsk == null || entryAsk <= 0 || exitBid == null) return null;
  return Math.round(((exitBid - entryAsk) / entryAsk) * 10000) / 100;
}

/** Execution tax in BASIS POINTS: mid P&L − executable P&L (1 percentage point = 100 bps).
 *  Positive = the executable lane realized less than mid (the tax the member actually pays);
 *  this is the histogram WS-10 emits beside the sibling calibration metrics. Null unless both
 *  lanes priced. */
export function executionTaxBps(midPnlPct: number | null, execPnlPct: number | null): number | null {
  if (midPnlPct == null || execPnlPct == null) return null;
  return Math.round((midPnlPct - execPnlPct) * 100);
}

/** Staleness predicate every renderer must apply (>ZERODTE_MARK_STALE_MS = dim). */
export function isZeroDteMarkStale(
  asOfMs: number,
  nowMs: number,
  staleAfterMs = ZERODTE_MARK_STALE_MS
): boolean {
  return !(asOfMs > 0) || nowMs - asOfMs > staleAfterMs;
}

/**
 * D-1 fix (wrong frozen P&L on stopped plays): a CLOSED row whose latched trough
 * crossed the −50% stop is a STOPPED play — its result is the stop P&L by the
 * plan's own methodology (gradePlanFromBars exits AT the stop), not whatever
 * last_mark happened to freeze at when the row closed. Order matches
 * derivePlayStatus: a peak that tagged the +100% target first makes TRIM sticky,
 * so such a row is never relabeled "stopped". Returns null for everything else
 * (live rows, time-stop closes) — those correctly show mark-derived P&L.
 */
export function closedStopReason(row: {
  status: string | null;
  entry_premium: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
}): "stopped" | null {
  const entry = row.entry_premium;
  if (row.status !== "CLOSED" || entry == null || entry <= 0) return null;
  const target = entry * (1 + PLAN_RULES.target_pct / 100);
  const stop = entry * (1 + PLAN_RULES.stop_pct / 100);
  if (row.peak_premium != null && row.peak_premium >= target) return null; // TRIM was sticky first
  if (row.trough_premium != null && row.trough_premium <= stop) return "stopped";
  return null;
}

/** Neutral trim-scale schedule (mirrors TRIM_SCALE_RULES.tranches_by_regime.neutral in exit-engine.ts).
 *  Used to estimate the AS-MANAGED blended P&L when a stopped runner still banked earlier tranches. */
const TRIM_SCALE_NEUTRAL_PCTS: readonly [number, number] = [20, 50];
const TRIM_SCALE_TRANCHE_FRAC = 1 / 3;

/**
 * Estimate trim-scale AS-MANAGED blended P&L when the runner exits at `runnerPnlPct` (default −50%
 * plan stop) but the latched peak had already armed one or both trim tranches. Returns null when
 * peak never reached the first trim (+20%) — the mechanical stop pin is then honest.
 *
 * Example: peak +87%, runner stopped at −50% → ⅓@+25 + ⅓@+50 + ⅓@(−50) ≈ +8.33%.
 */
/** Count of neutral trim-scale tranches the latched peak had armed (+20% / +50%). */
export function trimScaleTranchesArmed(peakPnlPct: number | null): number {
  if (peakPnlPct == null || !Number.isFinite(peakPnlPct)) return 0;
  let armed = 0;
  for (const t of TRIM_SCALE_NEUTRAL_PCTS) if (peakPnlPct >= t) armed += 1;
  return armed;
}

export function trimScaleBlendedPnlAtStop(
  peakPnlPct: number | null,
  runnerPnlPct: number = PLAN_RULES.stop_pct
): number | null {
  if (trimScaleTranchesArmed(peakPnlPct) === 0) return null;
  let armed = trimScaleTranchesArmed(peakPnlPct);
  let blended = 0;
  let remaining = 1;
  for (let i = 0; i < armed; i++) {
    blended += TRIM_SCALE_TRANCHE_FRAC * TRIM_SCALE_NEUTRAL_PCTS[i]!;
    remaining -= TRIM_SCALE_TRANCHE_FRAC;
  }
  blended += remaining * runnerPnlPct;
  return Math.round(blended * 100) / 100;
}

/** Peak premium P/L % vs pinned entry — the excursion high-water mark for closed-card display. */
export function peakPnlPct(entryPremium: number | null, peakPremium: number | null): number | null {
  return pinnedLivePnlPct(entryPremium, peakPremium);
}

/**
 * Directional closed-row P&L: the trim-scale AS-MANAGED blend ONLY when the row was actually
 * MANAGED under trim_scale; otherwise the mechanical stop pin.
 *
 * WHY THE POLICY ARGUMENT EXISTS. This function used to apply the blend to every stopped
 * directional row whose latched peak happened to clear +20%, without asking which exit policy had
 * managed it. Not every row is on trim_scale: `resolveExitModeForTier` commits C-tier plays under
 * RATCHET, and `ZERODTE_EXIT_MODE=ratchet` is an operator kill-switch for all tiers. A ratchet row
 * banks NOTHING on the way up — that is the entire difference between the two policies — so
 * crediting it ⅓@+20% and ⅓@+50% invents partial exits the member was never guided to take.
 *
 * The arithmetic makes the size of that plain: a row that peaked ≥ +50% and then stopped at −50%
 * renders as ⅓(+20) + ⅓(+50) + ⅓(−50) = **+6.67%**. A play that lost half its premium is displayed
 * as a WINNER, wearing a P&L the member could not have achieved under the policy their play was
 * committed with.
 *
 * `exitMode` is passed in rather than read here so this module stays pure and free of the env/DB
 * shell — the caller resolves it from the row's own frozen `entry_context.exit_policy_at_commit`
 * (`readFrozenExitMode`), the field WS/Q13 added precisely so a row is always judged under the
 * policy it was COMMITTED with rather than whatever the env says later.
 *
 * UNKNOWN POLICY PINS TO THE STOP, DELIBERATELY. A legacy row predating the pin returns null from
 * `readFrozenExitMode`. Rather than guess, this pins to the mechanical −50%. Of the two possible
 * errors on a stopped play, understating it is the safe one and overstating it is not — and the
 * mechanical pin is already a number the published methodology defines and reports.
 */
export function directionalClosedDisplayPnlPct(row: {
  status?: string | null;
  entry_premium: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
  last_mark: number | null;
  /** Board path: closed_reason already classified this row as stopped. */
  force_stopped?: boolean;
  /** Frozen exit policy for THIS row. Only "trim_scale" may claim banked tranches. */
  exitMode?: "ratchet" | "trim_scale" | null;
}): number | null {
  const isStopped =
    row.force_stopped === true ||
    closedStopReason({
      status: row.status ?? "CLOSED",
      entry_premium: row.entry_premium,
      peak_premium: row.peak_premium,
      trough_premium: row.trough_premium,
    }) === "stopped";
  if (!isStopped) {
    return pinnedLivePnlPct(row.entry_premium, row.last_mark);
  }
  // Only a row COMMITTED under trim_scale may be credited with banked tranches.
  if (row.exitMode !== "trim_scale") return PLAN_RULES.stop_pct;
  const peakPct = peakPnlPct(row.entry_premium, row.peak_premium);
  const managed = trimScaleBlendedPnlAtStop(peakPct, PLAN_RULES.stop_pct);
  return managed ?? PLAN_RULES.stop_pct;
}

/** The displayed P&L for a board ledger row: trim-scale AS-MANAGED when peak armed tranches on a
 *  stopped close; else mechanical stop pin; else mark-derived. */
export function ledgerDisplayPnlPct(row: {
  status: string | null;
  entry_premium: number | null;
  last_mark: number | null;
  peak_premium: number | null;
  trough_premium: number | null;
  /** Frozen exit policy for THIS row — see directionalClosedDisplayPnlPct. */
  exitMode?: "ratchet" | "trim_scale" | null;
}): number | null {
  if (row.status === "CLOSED") return directionalClosedDisplayPnlPct(row);
  if (closedStopReason(row) === "stopped") return PLAN_RULES.stop_pct;
  return pinnedLivePnlPct(row.entry_premium, row.last_mark);
}

/**
 * THE board ledger row's `live_pnl_pct` — the ONE place the payload assembler derives it, applied
 * IDENTICALLY at both build sites in zerodte-service (mapLedgerRow and the post-roundFloats
 * re-price off the member-visible rounded premiums). Three cases, in order:
 *   - CONDOR (credit structure): seller-framed (entry − mark)/entry (condorSellerPnlPct). The
 *     directional −50% stop-pin does NOT apply — a condor is breach-graded, has no premium stop
 *     level, and its loss is the defined-risk cap, not a fixed −50%.
 *   - a directional STOPPED close: trim-scale AS-MANAGED blend when peak armed tranches (shipped
 *     default exit mode); else the mechanical stop P&L pin (D-1 hold-to-stop comparison grade).
 *   - every other directional row: long-framed (mark − entry)/entry (pinnedLivePnlPct).
 * Pure + null-safe. Directional output is byte-identical to the previous inline expression.
 */
export function reconcileLedgerLivePnlPct(row: {
  is_condor: boolean;
  /** "stopped" triggers the trim-scale blend ONLY when exitMode is "trim_scale"; else stop pin. */
  closed_reason: string | null;
  entry_premium: number | null;
  last_mark: number | null;
  peak_premium?: number | null;
  trough_premium?: number | null;
  status?: string | null;
  /** Frozen exit policy for THIS row — see directionalClosedDisplayPnlPct. */
  exit_policy_at_commit?: "ratchet" | "trim_scale" | null;
}): number | null {
  if (row.is_condor) return condorSellerPnlPct(row.entry_premium, row.last_mark);
  if (row.closed_reason === "stopped") {
    return directionalClosedDisplayPnlPct({
      entry_premium: row.entry_premium,
      peak_premium: row.peak_premium ?? null,
      trough_premium: row.trough_premium ?? null,
      last_mark: row.last_mark,
      force_stopped: true,
      exitMode: row.exit_policy_at_commit ?? null,
    });
  }
  return pinnedLivePnlPct(row.entry_premium, row.last_mark);
}

export type PlayLatch = {
  peak: number | null;
  trough: number | null;
  status: PlayStatus;
};

/**
 * Advance one play's latched lifecycle from a fresh mark — the SAME peak/trough
 * latch + derivePlayStatus state machine syncLedgerLiveState (scan.ts) applies,
 * expressed as a pure function of (prior latch, mark, clock) so the 1s lane and
 * its tests never need a database. Latches only widen; a null mark advances the
 * clock (time stop) without touching the latches.
 */
/**
 * THE peak/trough latch — one implementation, shared by both lanes that latch.
 *
 * There were two, and they disagreed. `advancePlayLatch` (the 1s marks lane) latched null-safely;
 * `syncLedgerLiveState` in scan.ts latched inline as
 *   Math.min(trough_premium ?? (entry_premium ?? Number.MAX_VALUE), mark ?? Number.MAX_VALUE)
 * so a row with no prior trough, no entry premium and no fresh mark latched Number.MAX_VALUE —
 * 1.7976931348623157e308 — and served it as `trough_premium`. Iron condors are the population that
 * reaches it: a credit structure carries no single entry premium, so the first `??` falls through,
 * and any tick without a quote supplies the second.
 *
 * `advancePlayLatch`'s own doc comment claimed it applied "the SAME peak/trough latch
 * syncLedgerLiveState (scan.ts) applies". It did not — and a claim of sameness with no shared code
 * is exactly how the two drifted. The same row could carry a different trough depending on which
 * lane touched it last. Now there is one function and the claim is structural.
 *
 * NOTHING DOWNSTREAM CAUGHT THE SENTINEL because `Number.isFinite(1.79e308)` is TRUE — the
 * response-boundary sanitizer, the audit suite's `scanFinite` sweep and the malformed-value scan
 * all pass it through as a good number. Only reading the payload finds it.
 *
 * Absence stays absent: with no finite candidate on a side, that latch is null, which
 * `derivePlayStatus` has always accepted.
 */
export function latchPremiumBounds(
  seedPeak: number | null | undefined,
  seedTrough: number | null | undefined,
  mark: number | null | undefined
): { peak: number | null; trough: number | null } {
  const finite = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);
  const m = finite(mark) ? mark : null;
  const p = finite(seedPeak) ? seedPeak : null;
  const t = finite(seedTrough) ? seedTrough : null;
  return {
    peak: m != null ? (p != null ? Math.max(p, m) : m) : p,
    trough: m != null ? (t != null ? Math.min(t, m) : m) : t,
  };
}

export function advancePlayLatch(
  play: { entry_premium: number | null; peak_premium: number | null; trough_premium: number | null },
  prior: PlayLatch | null,
  mark: number | null,
  nowEtMinutes: number,
  opts?: { deferPlanStop?: boolean }
): PlayLatch {
  const entry = play.entry_premium;
  const seedPeak = prior?.peak ?? play.peak_premium ?? entry ?? null;
  const seedTrough = prior?.trough ?? play.trough_premium ?? entry ?? null;
  const { peak, trough } = latchPremiumBounds(seedPeak, seedTrough, mark);
  const state = derivePlayStatus({
    entryPremium: entry,
    mark,
    peak,
    trough,
    nowEtMinutes,
    deferPlanStop: opts?.deferPlanStop,
  });
  return { peak, trough, status: state.status };
}

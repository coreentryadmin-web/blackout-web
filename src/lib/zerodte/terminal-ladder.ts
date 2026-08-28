// Terminal v2 — pure derivations for the right-panel PlayTerminal render (Night Hawk
// Command Deck). Dependency-free leaf (only PLAN_RULES + the ResolvedExitPolicy SHAPE,
// type-only) so the board assembler, the client adapter, and their tests all share ONE
// derivation of the trim-scale ladder, the time-stop clock, and the executable fill.
//
// WHY THIS EXISTS. The terminal USED to hard-code exitModel:"RATCHET" and draw a single
// stop→target track for every 0DTE play — a rendered constant, not the row's actual policy.
// The exit engine supports TWO families: ratchet (arm/lock/runner floors) and trim_scale
// (bank ⅓@+25%, ⅓@+50%, run the last ⅓). Which one a row runs is FROZEN at commit in
// entry_context.exit_policy_snapshot from ZERODTE_EXIT_MODE. CORRECTED 2026-08-28 (this
// comment was stale): trim_scale is LIVE in prod, not dormant — DEFAULT_EXIT_MODE
// (exit-engine.ts) is "trim_scale", and resolveExitModeForTier (exit-sync.ts, the E5
// graduation) puts every A/B-tier commit on trim_scale by default regardless of the
// ZERODTE_EXIT_MODE env var; only C-tier/untiered plays default to ratchet. This module
// resolves whichever policy the row actually froze — trim_scale for A/B tier today, ratchet
// for C/untiered — instead of hard-coding one. Each trim tranche's premium LEVEL is priced
// off the pinned entry and FIRED when the latched peak reaches it, so the ladder (when
// trim_scale IS the frozen policy) matches the strategy the engine ran.

import { PLAN_RULES } from "./plan";

/** One profit-taking rung of the resolved trim ladder for the terminal. `premium` is the
 *  ABSOLUTE per-contract level (entry × (1 + trigger_pct/100)) the tranche banks at; `fired`
 *  is whether the latched peak has reached that level (the live analog of the grader's
 *  bid-high-armed-the-trim reconstruction — plan.ts reconstructTrimScaleExecutableFromBars).
 *  Null premium when the row has no entry basis to price the level off — never a guess. */
export type TerminalExitTranche = {
  trigger_pct: number;
  fraction: number;
  premium: number | null;
  fired: boolean;
};

/** The fully-resolved exit ladder the terminal renders — the trim-scale partial-scale-out
 *  ladder (`policy: "trim_scale"`) OR the single ratchet track (`policy: "ratchet"`). Built
 *  from the row's FROZEN exit-policy snapshot (or the default policy for a legacy row), so a
 *  later code edit can never retroactively change how a committed play is drawn. Additive on
 *  the payload; the client passes it through without re-deriving the policy. */
export type TerminalExitLadder = {
  policy: "ratchet" | "trim_scale";
  hard_stop_pct: number;
  target_pct: number;
  /** Profit-taking tranches in fire order (trim_scale = the ⅓/⅓ ladder; ratchet = the single
   *  +100% half-trim). Each priced + fired-flagged against the row's entry/peak. */
  trim_levels: TerminalExitTranche[];
  /** Fraction left running after the trims (the runner that rides the plan rails). */
  runner_fraction: number;
  /** Absolute premium levels of the runner's rails (entry × (1 ± pct/100)); null without entry. */
  stop_premium: number | null;
  target_premium: number | null;
  /** ET "H:MM" hard time-stop (15:30). */
  time_stop_et: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The numeric subset of a ResolvedExitPolicy this module needs — kept structural (not the
 *  imported type) so a caller can pass a frozen snapshot blob, a buildResolvedExitPolicy()
 *  result, or a hand-built default without a type dance. */
export type TerminalPolicyInput = {
  policy: "ratchet" | "trim_scale";
  hard_stop_pct: number;
  target_pct: number;
  trim_levels: { trigger_pct: number; fraction: number }[];
  runner_fraction: number;
  time_stop_et: string;
};

/**
 * Resolve the terminal exit ladder for one row. Prices each trim level off the PINNED entry
 * premium and flags it FIRED when the latched `peakPremium` has reached that level — the same
 * "the peak armed the trim" rule the executable reconstruction uses (plan.ts). Pure; a null
 * entry leaves every premium null (the render degrades to "—", never a fabricated level).
 */
export function buildTerminalExitLadder(
  policy: TerminalPolicyInput,
  entryPremium: number | null,
  peakPremium: number | null
): TerminalExitLadder {
  const hasEntry = entryPremium != null && entryPremium > 0;
  const levelFor = (pct: number): number | null =>
    hasEntry ? round2(entryPremium! * (1 + pct / 100)) : null;
  // CAVEAT (documented, deliberate): `fired` arms on the latched MID peak (peak_premium ≥
  // level) — this matches the live status machine (derivePlayStatus, marks-math.ts), which is
  // what drives the card the member is looking at. The post-hoc executable GRADER
  // (reconstructTrimScaleExecutableFromBars) arms a trim on the BID high instead, so it can
  // book a trim slightly LATER than this display shows. That divergence is the same
  // optimistic-mid vs conservative-bid gap already reconciled in record.ts; the terminal shows
  // the live (mid) view on purpose, not the grader's executable view.
  const firedAt = (level: number | null): boolean =>
    level != null && peakPremium != null && peakPremium >= level;

  const trim_levels: TerminalExitTranche[] = (policy.trim_levels ?? []).map((t) => {
    const premium = levelFor(t.trigger_pct);
    return { trigger_pct: t.trigger_pct, fraction: t.fraction, premium, fired: firedAt(premium) };
  });

  return {
    policy: policy.policy,
    hard_stop_pct: policy.hard_stop_pct,
    target_pct: policy.target_pct,
    trim_levels,
    runner_fraction: policy.runner_fraction,
    stop_premium: levelFor(policy.hard_stop_pct),
    target_premium: levelFor(policy.target_pct),
    time_stop_et: policy.time_stop_et,
  };
}

// ── Time-stop clock (item 4) ────────────────────────────────────────────────────────────
/** RTH open in ET minutes-since-midnight — the session-decay bar's left edge (09:30). */
export const RTH_OPEN_ET_MINUTES = 9 * 60 + 30;

export type TimeStopClock = {
  /** Whole minutes until the hard time-stop (0 once past it — never negative). */
  minutes_remaining: number;
  /** "H:MM" of the remaining time (e.g. "2:14"); "0:00" at/after the stop. */
  label: string;
  /** 0→1 fraction of the RTH window (09:30→hard exit) already elapsed — the decay bar fill.
   *  Clamped [0,1]; before the open it is 0, after the time-stop it is 1. */
  elapsed_frac: number;
  /** True once the hard time-stop has passed (drives the "TIME STOP" flag). */
  past_time_stop: boolean;
};

/** Pure time-stop clock from an ET minute-of-day. Testable without a real clock. */
export function timeStopClock(nowEtMinutes: number): TimeStopClock {
  const stop = PLAN_RULES.time_stop_et_minutes;
  const remaining = Math.max(0, stop - nowEtMinutes);
  const span = stop - RTH_OPEN_ET_MINUTES; // 360 min RTH window
  const elapsed = span > 0 ? (nowEtMinutes - RTH_OPEN_ET_MINUTES) / span : 0;
  return {
    minutes_remaining: remaining,
    label: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`,
    elapsed_frac: Math.max(0, Math.min(1, elapsed)),
    // Strict `>`, matching derivePlayStatus (plan.ts) and every grader's own time-stop
    // boundary check — all use `nowEtMinutes > time_stop_et_minutes` (the boundary minute
    // itself is still in the window; plan.test.ts pins this as "inclusive"). This used to
    // read `>=`, so the displayed "TIME STOP" flag lit up a full minute before the play's
    // actual lifecycle/grading boundary — cosmetic only (nothing here grades a play), but a
    // real, previously-undocumented clock mismatch. Found 2026-08-26.
    past_time_stop: nowEtMinutes > stop,
  };
}

// ── Executable fill (item 3) ────────────────────────────────────────────────────────────
export type ExecutableFill = {
  /** The MID (display mark) — (bid+ask)/2. Null without a two-sided book. */
  mid: number | null;
  /** The BID a member actually EXITS a long into (the honest fill). Null without a bid. */
  fill: number | null;
  /** Executable P&L % = (bid − entry)/entry against the PINNED entry. Null without both. */
  pnl_pct: number | null;
};

/**
 * Executable exit fill for a long-premium 0DTE play from a live two-sided book. A long is
 * SOLD into the BID, so the achievable exit is the bid, not the mid — the mid systematically
 * flatters the return (WS-10). Returns mid-only (fill/pnl null) when there is no valid
 * two-sided quote: NEVER a fabricated fill. Same validity guard as zeroDteMidOf (ask>0,
 * bid>=0, ask>=bid).
 */
export function executableFill(
  bid: number | null,
  ask: number | null,
  entryPremium: number | null
): ExecutableFill {
  const validBook = bid != null && ask != null && ask > 0 && bid >= 0 && ask >= bid;
  const mid = validBook ? round2((bid + ask) / 2) : null;
  // A one-sided book (ask only) still has no bid to sell into → no honest fill.
  const fill = validBook && bid > 0 ? round2(bid) : null;
  const pnl_pct =
    fill != null && entryPremium != null && entryPremium > 0
      ? Math.round(((fill - entryPremium) / entryPremium) * 10000) / 100
      : null;
  return { mid, fill, pnl_pct };
}

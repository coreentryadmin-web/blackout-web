// 0DTE Command session governor (G-5) — the portfolio-level risk layer this surface
// never had. Mirrors the SHAPE of SPX Slayer's trade governor (entry caps, loss
// halt, re-entry locks — src/features/spx/lib/trade-governor.ts, read-only
// reference) but is deliberately zerodte-local: this surface has its own ledger,
// its own fixed −50/+100 plan, and no playbook/desk machinery, so importing the
// Slayer module would drag in its whole config/desk graph for three rules.
//
// Evidence (NIGHTHAWK-0DTE-DECISION.md §2, G-5): 2026-07-13 had SEVEN stops with no
// ceiling — the scanner kept committing fresh plans all the way down. Slayer's
// governor (halt after 3 losses, re-entry locks) is the one piece of its stack with
// a proven closed-ledger effect (48% WR from a ~42% signal environment).
//
// AUDIT SEV-3 (2026-07-24) — realized-loss day-halt (additive, strictly more
// conservative). The original 3-strike session halt counts ONLY −50% HARD stops
// (plan_outcome "stopped" / trough ≤ entry·0.5). A LOSING TIME-STOP — a play that
// closes red at 15:30 (e.g. −25%…−45%) without ever touching the hard stop — was
// explicitly excluded, so a chop-and-bleed day where 5–6 committed plays each
// time-stop red never tripped the halt and the scanner kept committing all day: the
// SAME capital loss as the 7/13 incident this governor was built for, reached by a
// different exit reason and entirely uncapped. The fix adds a realized-loss halt
// ALONGSIDE the hard-stop halt — it counts realized LOSERS regardless of exit reason
// (any closed row with realized P&L < 0) and also guards a cumulative session-P&L
// floor. The hard-stop count is left untouched (its re-entry lock still keys off it).
// This channel only ever ADDS halting, never removes it.
//
// State model — deterministic and replica-safe:
// - open plans and the stopped-play COUNT derive from the Postgres ledger
//   (zerodte_setup_log), which every replica already shares — the halt decision
//   never depends on a cache being warm.
// - Stop TIMESTAMPS (which Postgres doesn't store) are recorded to Redis via the
//   shared cache (same lane the zerodte:board:v1 payload cache rides), keyed by
//   session date, so the 20-minute re-entry lock agrees across replicas. Losing
//   Redis degrades ONLY the lock's timing precision (an untimed ledger stop still
//   counts toward the halt); it never un-halts a halted session.
//
// Pure evaluation + thin persistence, same split as ./gates.ts.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { PLAN_RULES } from "./plan";
import type { ZeroDteSetupLogRow } from "@/lib/db";
import type { ZeroDteGateBlock } from "./gates";

/** Max simultaneously-open plans. Slayer allows 5 entries/session on ONE instrument
 *  with an exit engine; this breadth surface manages every play to a fixed plan, so
 *  the concurrent-exposure cap is tighter. */
export const GOVERNOR_MAX_CONCURRENT_PLANS = 3;
/** Stops in a session before the desk stands down for the day (Slayer's own
 *  loss-halt number). 7/13 took 7 stops — this caps that class of day at 3. */
export const GOVERNOR_MAX_SESSION_STOPS = 3;
/** Same-direction re-entry lock on a ticker after its stop (Slayer's 20m rule). */
export const GOVERNOR_REENTRY_LOCK_MS = 20 * 60 * 1000;

// ── AUDIT SEV-3 realized-loss halt thresholds ──────────────────────────────────────
// CONSERVATIVE STARTING VALUES — to be tuned on the ledger (calibration-first). Both
// mirror the hard-stop halt's SHAPE: the count mirrors the 3-stop ceiling, and the
// floor is a cushion above three −50% hard stops (−150%) so a bleed of smaller losing
// time-stops (each ~−25%…−45%) trips it before it reaches the same total drawdown as
// the 7/13 day. Either condition halts new commits.
/** Realized LOSERS in a session — regardless of exit reason (hard stop OR losing
 *  time-stop) — before the desk stands down. Mirrors the 3-stop hard-halt shape. */
export const GOVERNOR_LOSS_HALT_COUNT = 3;
/** Cumulative session realized P&L % floor. At/below this, new commits halt even if
 *  the loser COUNT hasn't hit the cap (a few large losers drain capital just as fast
 *  as many small ones). −120% ≈ 2.4 hard stops' worth of realized drawdown. */
export const GOVERNOR_SESSION_LOSS_FLOOR_PCT = -120;

export type GovernorStopEvent = {
  ticker: string;
  direction: "long" | "short";
  /** Epoch-ms the stop was observed (Redis-recorded). Null for stops derived from
   *  the ledger alone (Postgres stores no stop time) — those still count toward the
   *  session halt but cannot drive the timed re-entry lock. Never fabricated. */
  at_ms: number | null;
};

export type GovernorOpenPlan = { ticker: string; direction: "long" | "short" };

export type GovernorSnapshot = {
  /** Plans currently not CLOSED (null status = just committed, presumptively live).
   *  Carried as (ticker, direction) pairs — one source for BOTH the concurrency
   *  count and the correlated-conflict check. */
  open_plans: GovernorOpenPlan[];
  /** One entry per stopped ticker this session (ledger ∪ Redis-recorded). */
  stops: GovernorStopEvent[];
  /** AUDIT SEV-3: realized LOSERS this session regardless of exit reason — every
   *  CLOSED row whose realized P&L is < 0 (a losing time-stop counts, not just a
   *  −50% hard stop). Optional so pre-existing snapshot literals (scan.ts, tests)
   *  still type-check; treated as 0 when absent. deriveGovernorFromLedger always
   *  sets it. */
  realized_losers?: number;
  /** AUDIT SEV-3: cumulative realized session P&L % (sum of graded plan_pnl_pct over
   *  CLOSED rows; a −50% fallback stands in for a trough-proven but ungraded hard
   *  stop). Winners net against losers. Optional for the same back-compat reason. */
  session_pnl_pct?: number;
};

// B-3 (docs/audit/0DTE-BREAKTHROUGH-LEDGER.md) — correlated-conflict rule.
// Evidence: 7/13 ran SPY long AND QQQ short simultaneously — correlated
// instruments, one guaranteed loser. v1 keeps ONE static group (the broad
// index/ETF complex); sector pairs (e.g. NVDA/AMD) come later via the calibration
// loop once per-play evidence says which pairs actually co-move enough to matter.
export const CORRELATION_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "XSP"]),
];

/** The correlation group a ticker belongs to, or null. Exported so the SWING theme resolver
 *  (src/lib/swing/theme-cluster.ts, SEV-9) can seed its broad-market cluster from the ONE
 *  correlation-group source instead of hand-copying the index/ETF list. Caller must uppercase. */
export function correlationGroupOf(ticker: string): ReadonlySet<string> | null {
  for (const g of CORRELATION_GROUPS) if (g.has(ticker)) return g;
  return null;
}

/** The ledger fields the governor reads — subset so tests need no full row. */
export type GovernorLedgerRow = Pick<
  ZeroDteSetupLogRow,
  "ticker" | "direction" | "status" | "entry_premium" | "trough_premium" | "plan_outcome" | "plan_pnl_pct"
>;

/** Did this ledger row stop out? Two independent signals, either suffices:
 *  the graded plan_outcome, or the latched trough at/below the plan's stop level
 *  (derivePlayStatus's own CLOSED/stopped condition) — so the count is right even
 *  before the lazy grader has run. A time-stop close is NOT a stop. */
function ledgerRowStopped(r: GovernorLedgerRow): boolean {
  if (r.plan_outcome === "stopped") return true;
  if (r.status !== "CLOSED") return false;
  return (
    r.entry_premium != null &&
    r.entry_premium > 0 &&
    r.trough_premium != null &&
    r.trough_premium <= r.entry_premium * (1 + PLAN_RULES.stop_pct / 100)
  );
}

/** AUDIT SEV-3: a CLOSED row's REALIZED session P&L % contribution, or null if the
 *  row isn't realized yet. Prefers the graded plan_pnl_pct (the true close P&L, which
 *  captures a losing time-stop the −50%-only hard-stop test never sees); falls back to
 *  the −50% stop level for a row whose latched trough already proves a hard stop but
 *  the lazy grader hasn't stamped plan_pnl_pct yet (mirrors ledgerRowStopped, so the
 *  halt is right BEFORE grading, same discipline the stop count already uses). */
function ledgerRowRealizedPnlPct(r: GovernorLedgerRow): number | null {
  if (r.plan_pnl_pct != null && Number.isFinite(r.plan_pnl_pct)) return r.plan_pnl_pct;
  if (ledgerRowStopped(r)) return PLAN_RULES.stop_pct; // −50, proven by outcome/trough
  return null;
}

/** Deterministic snapshot from today's ledger rows (the shared-Postgres half). */
export function deriveGovernorFromLedger(rows: GovernorLedgerRow[]): GovernorSnapshot {
  const stops: GovernorStopEvent[] = [];
  const openPlans: GovernorOpenPlan[] = [];
  let realizedLosers = 0;
  let sessionPnlPct = 0;
  for (const r of rows) {
    if (r.status !== "CLOSED") openPlans.push({ ticker: r.ticker.toUpperCase(), direction: r.direction });
    if (ledgerRowStopped(r)) stops.push({ ticker: r.ticker.toUpperCase(), direction: r.direction, at_ms: null });
    // AUDIT SEV-3 — realized-loss tallies, independent of the stop channel above so a
    // losing time-stop (never in `stops`) still counts toward the day-halt.
    const pnl = ledgerRowRealizedPnlPct(r);
    if (pnl != null) {
      sessionPnlPct += pnl;
      if (pnl < 0) realizedLosers += 1;
    }
  }
  return { open_plans: openPlans, stops, realized_losers: realizedLosers, session_pnl_pct: sessionPnlPct };
}

/**
 * AUDIT SEV-3 — the realized-loss day-halt verdict, as a human sentence or null.
 * Halts when EITHER the realized-loser count hits the cap (mirrors the 3-stop
 * hard-halt) OR cumulative session P&L sinks to/below the floor. Pure over the
 * snapshot's own tallies; absent tallies read as 0 (no halt) so a snapshot built by
 * an older path can't spuriously trip it. Exposed so the board can SURFACE the reason
 * (would_halt) as calibration evidence even where the gate stack hasn't enforced it.
 */
export function governorLossHaltReason(snap: GovernorSnapshot): string | null {
  const losers = snap.realized_losers ?? 0;
  const sessionPnl = snap.session_pnl_pct ?? 0;
  if (losers >= GOVERNOR_LOSS_HALT_COUNT) {
    return (
      `Session governor: ${losers} realized losers today (max ${GOVERNOR_LOSS_HALT_COUNT}, ANY exit ` +
      "reason — a losing time-stop counts, not just a −50% hard stop) — no new commits for the rest " +
      "of the session. 7/13's bleed came the same way, uncapped (AUDIT SEV-3)."
    );
  }
  if (sessionPnl <= GOVERNOR_SESSION_LOSS_FLOOR_PCT) {
    return (
      `Session governor: cumulative realized session P&L ${Math.round(sessionPnl)}% at/below the ` +
      `${GOVERNOR_SESSION_LOSS_FLOOR_PCT}% floor — no new commits for the rest of the session (AUDIT SEV-3).`
    );
  }
  return null;
}

/** Union ledger-derived stops with Redis-recorded ones (per ticker). A recorded
 *  event wins because it carries the timestamp the re-entry lock needs; a ledger
 *  stop with no recorded twin stays timeless but still counts toward the halt. */
export function mergeGovernorStops(
  ledgerStops: GovernorStopEvent[],
  recorded: GovernorStopEvent[]
): GovernorStopEvent[] {
  const byTicker = new Map<string, GovernorStopEvent>();
  for (const s of ledgerStops) byTicker.set(s.ticker.toUpperCase(), { ...s, ticker: s.ticker.toUpperCase() });
  for (const s of recorded) {
    const t = s.ticker.toUpperCase();
    const existing = byTicker.get(t);
    if (!existing || (existing.at_ms == null && s.at_ms != null)) {
      byTicker.set(t, { ...s, ticker: t });
    }
  }
  return Array.from(byTicker.values());
}

/**
 * The pure G-5 verdict for one fresh candidate. `committedThisCycle` carries fresh
 * commits ALREADY accepted earlier in this same scan pass (setups arrive
 * score-ranked), so a single cycle can never blow through the concurrency cap — or
 * commit two correlated-but-opposed plans — against the same pre-cycle snapshot.
 *
 * Note on reachability: the ledger's (session_date, ticker) primary key already
 * prevents a second same-session commit on a stopped ticker, so the re-entry lock
 * is defense-in-depth today — it becomes load-bearing the moment re-entries exist
 * (and it is what the morning-gate checklist simulates).
 */
export function evaluateZeroDteGovernor(
  candidate: { ticker: string; direction: "long" | "short" },
  snap: GovernorSnapshot,
  nowMs: number,
  committedThisCycle: GovernorOpenPlan[] = []
): ZeroDteGateBlock[] {
  const blocks: ZeroDteGateBlock[] = [];

  // Session halt dominates — after 3 stops the answer is "no more today", full stop.
  if (snap.stops.length >= GOVERNOR_MAX_SESSION_STOPS) {
    blocks.push({
      code: "governor_session_stops",
      reason:
        `Session governor: ${snap.stops.length} plays stopped out today (max ${GOVERNOR_MAX_SESSION_STOPS}) — ` +
        "no new commits for the rest of the session. 7/13 took 7 uncapped stops; this is the ceiling.",
      threshold: GOVERNOR_MAX_SESSION_STOPS,
      unlock_et: null,
    });
    return blocks;
  }

  // AUDIT SEV-3 — realized-loss halt, ALONGSIDE the hard-stop halt above and equally
  // dominating. Catches the chop-and-bleed day the hard-stop count misses: enough
  // committed plays closing red (losing time-stops that never hit −50%) drains the
  // same capital as the 7/13 seven-stop day but through a different exit reason. Reuses
  // the existing governor_session_stops gate code deliberately — it IS a session halt,
  // and the ZeroDteGateFailure union (board.ts) is intentionally left untouched to keep
  // this change scoped to governor.ts; the realized-loss cause is spelled out in the
  // reason. Strictly additive: it can only ADD a block, never remove one.
  const lossHalt = governorLossHaltReason(snap);
  if (lossHalt) {
    blocks.push({
      code: "governor_session_stops",
      reason: lossHalt,
      threshold: GOVERNOR_LOSS_HALT_COUNT,
      unlock_et: null,
    });
    return blocks;
  }

  const liveExposure = [...snap.open_plans, ...committedThisCycle];

  if (liveExposure.length >= GOVERNOR_MAX_CONCURRENT_PLANS) {
    blocks.push({
      code: "governor_max_concurrent",
      reason:
        `Session governor: ${liveExposure.length} plans already live (max ` +
        `${GOVERNOR_MAX_CONCURRENT_PLANS} concurrent) — manage what's open before adding exposure.`,
      threshold: GOVERNOR_MAX_CONCURRENT_PLANS,
      unlock_et: null,
    });
  }

  // B-3 — correlated conflict: a new plan must not fight an OPEN plan on a
  // correlated instrument (7/13 ran SPY long + QQQ short at once — one guaranteed
  // loser). Direction AGREEMENT is fine; only opposition blocks.
  const candidateTicker = candidate.ticker.toUpperCase();
  const group = correlationGroupOf(candidateTicker);
  if (group) {
    const opposed = liveExposure.find(
      (p) =>
        p.ticker.toUpperCase() !== candidateTicker &&
        group.has(p.ticker.toUpperCase()) &&
        p.direction !== candidate.direction
    );
    if (opposed) {
      blocks.push({
        code: "correlated_conflict",
        reason:
          `Session governor: ${candidateTicker} ${candidate.direction} opposes the OPEN ` +
          `${opposed.ticker.toUpperCase()} ${opposed.direction} — correlated index/ETF exposure ` +
          "in both directions is one guaranteed loser (7/13 ran SPY long + QQQ short simultaneously).",
        threshold: null,
        unlock_et: null,
      });
    }
  }

  const ticker = candidate.ticker.toUpperCase();
  for (const s of snap.stops) {
    if (
      s.ticker === ticker &&
      s.direction === candidate.direction &&
      s.at_ms != null &&
      nowMs - s.at_ms < GOVERNOR_REENTRY_LOCK_MS
    ) {
      const minsLeft = Math.ceil((GOVERNOR_REENTRY_LOCK_MS - (nowMs - s.at_ms)) / 60_000);
      blocks.push({
        code: "governor_reentry_lock",
        reason:
          `Session governor: ${ticker} ${candidate.direction} stopped out under 20 minutes ago — ` +
          `same-direction re-entry locked for ~${minsLeft} more minute${minsLeft === 1 ? "" : "s"}.`,
        threshold: GOVERNOR_REENTRY_LOCK_MS / 60_000,
        unlock_et: null,
      });
      break;
    }
  }

  return blocks;
}

// ── Member-facing board summary (additive, PR-D) ──────────────────────────────────
// The Night Hawk 0DTE pane's governor strip renders session risk state — open plans
// n/cap, stops n/halt (loud at the halt), re-entry locks with time remaining. The
// board payload carries this summary so the client never re-derives risk state from
// ledger rows (and so the caps/lock length are payload numbers, not a second
// hardcoded copy that could drift from the real gate constants above).

export type ZeroDteGovernorSummary = {
  open_plans: GovernorOpenPlan[];
  max_concurrent: number;
  stops: GovernorStopEvent[];
  max_session_stops: number;
  /** True when the desk is stood down for the session — hard-stop halt (stops.length
   *  >= max_session_stops) OR the AUDIT SEV-3 realized-loss halt (would_halt != null). */
  halted: boolean;
  /** Same-direction re-entry lock length (ms) — the client counts down from each
   *  stop's at_ms + this; a stop with at_ms null gets no timer (never fabricated). */
  reentry_lock_ms: number;
  // ── AUDIT SEV-3 realized-loss halt surface (calibration-first) ──────────────────
  /** Realized losers this session (any exit reason). */
  realized_losers: number;
  /** Cumulative realized session P&L % (winners net against losers). */
  session_pnl_pct: number;
  /** The realized-loser cap driving the loss-halt (payload number, not a UI copy). */
  loss_halt_count: number;
  /** The cumulative-P&L floor driving the loss-halt. */
  session_loss_floor_pct: number;
  /** The realized-loss halt reason if the loss-halt condition is met, else null —
   *  SURFACED so the operator sees the halt firing on ledger evidence. Non-null here
   *  is already reflected in `halted` (this channel enforces). */
  would_halt: string | null;
};

/** Pure: the payload's governor block from today's ledger rows + the recorded
 *  (timestamped) stop events — the exact snapshot evaluateZeroDteGovernor judges. */
export function summarizeGovernorForBoard(
  rows: GovernorLedgerRow[],
  recordedStops: GovernorStopEvent[]
): ZeroDteGovernorSummary {
  const snap = deriveGovernorFromLedger(rows);
  const stops = mergeGovernorStops(snap.stops, recordedStops);
  // AUDIT SEV-3 — the realized-loss halt reason keys off the ledger-derived tallies
  // (timestamps don't matter for it), so compute it from `snap`, not the merged stops.
  const wouldHalt = governorLossHaltReason(snap);
  return {
    open_plans: snap.open_plans,
    max_concurrent: GOVERNOR_MAX_CONCURRENT_PLANS,
    stops,
    max_session_stops: GOVERNOR_MAX_SESSION_STOPS,
    halted: stops.length >= GOVERNOR_MAX_SESSION_STOPS || wouldHalt != null,
    reentry_lock_ms: GOVERNOR_REENTRY_LOCK_MS,
    realized_losers: snap.realized_losers ?? 0,
    session_pnl_pct: snap.session_pnl_pct ?? 0,
    loss_halt_count: GOVERNOR_LOSS_HALT_COUNT,
    session_loss_floor_pct: GOVERNOR_SESSION_LOSS_FLOOR_PCT,
    would_halt: wouldHalt,
  };
}

// ── Redis-backed stop-event record (shared across replicas) ───────────────────────

const governorStopsKey = (sessionDate: string) => `zerodte:governor:stops:${sessionDate}`;
/** Session state only needs to outlive the trading day; 24h TTL self-cleans. */
const GOVERNOR_STATE_TTL_SEC = 24 * 60 * 60;

type RecordedStop = { ticker: string; direction: "long" | "short"; at_ms: number };

/** Read the session's recorded stop events. Empty array on any failure — the
 *  ledger-derived stops (Postgres) remain the authoritative halt count, so a cold/
 *  down Redis can only soften the timed re-entry lock, never lift a halt. */
export async function loadRecordedGovernorStops(sessionDate: string): Promise<GovernorStopEvent[]> {
  try {
    const raw = await sharedCacheGet<RecordedStop[]>(governorStopsKey(sessionDate));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s) =>
          s &&
          typeof s.ticker === "string" &&
          (s.direction === "long" || s.direction === "short") &&
          Number.isFinite(s.at_ms)
      )
      .map((s) => ({ ticker: s.ticker.toUpperCase(), direction: s.direction, at_ms: s.at_ms }));
  } catch {
    return [];
  }
}

/**
 * Record newly-observed stop transitions (called by scan.ts's syncLedgerLiveState
 * when a row flips to CLOSED/stopped). First-write-wins per ticker: a stop time,
 * once recorded, is never overwritten by a later observation of the same (already
 * stopped) row — the lock must measure from the FIRST sighting.
 */
export async function recordGovernorStops(
  sessionDate: string,
  events: RecordedStop[]
): Promise<void> {
  if (events.length === 0) return;
  const existing = await loadRecordedGovernorStops(sessionDate);
  const byTicker = new Map<string, GovernorStopEvent>(existing.map((s) => [s.ticker, s]));
  let changed = false;
  for (const e of events) {
    const t = e.ticker.toUpperCase();
    if (byTicker.has(t)) continue;
    byTicker.set(t, { ticker: t, direction: e.direction, at_ms: e.at_ms });
    changed = true;
  }
  if (!changed) return;
  await sharedCacheSet(
    governorStopsKey(sessionDate),
    Array.from(byTicker.values()),
    GOVERNOR_STATE_TTL_SEC
  );
}

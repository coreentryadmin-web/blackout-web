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
import { timeOfDayFactor } from "./intraday";

/** Concurrent open-plan ceiling — env `ZERODTE_MAX_CONCURRENT` (default 100).
 *  Product intent (2026-07-29): do NOT starve the desk with an artificial scarcity
 *  cap of 3/6. Quality gates + session stop/loss floors are the real risk brake;
 *  every setup that clears them should be free to commit. Default 100 is effectively
 *  "no desk scarcity" for a whole-market board while still bounding runaway commits
 *  if something else fails open. Set `ZERODTE_MAX_CONCURRENT=0` for unlimited. */
function envConcurrentCap(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  if (raw === "0" || raw.toLowerCase() === "unlimited") return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}
export const GOVERNOR_MAX_CONCURRENT_PLANS = envConcurrentCap("ZERODTE_MAX_CONCURRENT", 100);
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
/** Realized LOSERS in a session before the desk stands down. Raised from 3 to 5:
 *  old count treated a -2% time-stop the same as a -50% hard stop, halting on 3
 *  mild losers that barely dented capital. The SESSION_LOSS_FLOOR_PCT (-120%) still
 *  catches rapid capital drain regardless of count. */
export const GOVERNOR_LOSS_HALT_COUNT = 5;
/** Cumulative session realized P&L % floor. At/below this, new commits halt even if
 *  the loser COUNT hasn't hit the cap (a few large losers drain capital just as fast
 *  as many small ones). −120% ≈ 2.4 hard stops' worth of realized drawdown. */
export const GOVERNOR_SESSION_LOSS_FLOOR_PCT = -120;

export type GovernorStopEvent = {
  ticker: string;
  direction: "long" | "short";
  /** Epoch-ms the stop was observed (Redis-recorded). Null for stops derived from
   *  the ledger alone (Postgres stores no stop time) — never fabricated. Such a stop
   *  still counts toward the session halt AND still locks same-direction re-entry, but
   *  fail-closed for the whole session instead of on a 20-minute timer it has no basis
   *  to measure (see the G-5 loop in evaluateZeroDteGovernor). */
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
// Governor opposing-direction conflict scope: instruments that are direct hedging
// proxies (SPY long + QQQ short = guaranteed one loser). Intentionally NARROWER
// than SPX_CORRELATED_TICKERS (gates.ts G-6) which also catches sympathy movers.
export const CORRELATION_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "XSP"]),
  new Set(["NVDA", "AMD", "INTC", "MU"]),     // Semiconductors — high intraday beta co-movement
  new Set(["MSFT", "GOOGL", "META", "AMZN"]), // Mega-cap tech — correlated on macro/NQ moves
  new Set(["AAPL", "AVGO", "CRM", "ADBE"]),   // Tech/enterprise — second tech cluster
  new Set(["JPM", "GS", "MS", "BAC"]),         // Financials — rate-sensitive, move together on yields
];

/** WS-05 version stamp for the concentration MEASURE frozen at commit (freezeConcentration
 *  State below). Bump BY HAND when the concentration definition changes (which groups, how
 *  same-beta/same-direction is counted) so a calibration read can partition frozen states by
 *  the logic that produced them — same discipline as CONCENTRATION_POLICY's sibling version
 *  strings. v1 = the single broad-index/ETF group + same-direction/same-group counting. */
export const CONCENTRATION_POLICY_VERSION = "v2";

/** A stable, deterministic id for a correlation group — its sorted members joined — so a
 *  frozen concentration state names the exact group it measured without depending on array
 *  index (which would silently re-map if the group list is reordered). Pure. */
export function correlationGroupId(group: ReadonlySet<string>): string {
  return `cg:${Array.from(group).map((t) => t.toUpperCase()).sort().join("-")}`;
}

/** The correlation group a ticker belongs to, or null. Exported so the SWING theme resolver
 *  (src/lib/swing/theme-cluster.ts, SEV-9) can seed its broad-market cluster from the ONE
 *  correlation-group source instead of hand-copying the index/ETF list. Caller must uppercase. */
export function correlationGroupOf(ticker: string): ReadonlySet<string> | null {
  for (const g of CORRELATION_GROUPS) if (g.has(ticker)) return g;
  return null;
}

// ── Q9 (design record) — SAME-DIRECTION concentration, MEASURE-then-ENFORCE ──
// The correlated-conflict rule above blocks OPPOSING plays on correlated names (SPY-long
// + QQQ-short). It does NOT see same-DIRECTION concentration: SPY-long + QQQ-long +
// IWM-long is 3× the same broad-market beta behind the 3-concurrent cap — one bad tape
// takes all three. Q9 flagged this as a genuine gap.
//
// WHY IT SHIPPED MEASURE-ONLY FIRST. Unlike the realized-loss halt (unambiguously good —
// you're already down, stand down), concentration is ambiguous: three independent origins
// all surfacing correlated longs can be CONVICTION, not reckless over-exposure. Enforcing a
// cap could forgo the best trend days. So — per the house calibration-first rule ("evidence,
// not gating; the ledger graduates it before it sizes") — this shipped first as a SURFACED
// measure: the board reported the largest same-direction correlated cluster and a
// would-block reason, and the ledger accrued whether concentrated days won or lost.
//
// CORRECTED 2026-08-28 (this comment was stale): it IS now enforced by default
// (GOVERNOR_ENFORCE_CONCENTRATION below). The flip was evidence-driven, not a guess — the
// 2026-07-30 session (FINDINGS.md, "Wave A/B strongest-engines hardening") was a real P0/P1
// incident (14 losers / 1 winner) where unmeasured same-direction concentration was one of
// five named contributing root causes, alongside the regime-plane gap and a stale-BREAKOUT
// score floor fixed in the same pass. GOVERNOR_MAX_CORRELATED_SAME_DIR=2 remains the
// original conservative starting value from before that flip — it has not itself been
// re-measured since enforcement began.

/** Max same-direction correlated open plans before the concentration measure flags it.
 *  CONSERVATIVE starting value (calibration-first) — with the 3-concurrent cap, a cluster
 *  of 3 same-direction correlated plays is the whole book pointed one way behind one beta;
 *  flagging at 2 means "one more correlated same-direction add would be over-concentration". */
export const GOVERNOR_MAX_CORRELATED_SAME_DIR = 2;

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return defaultOn;
}

/** Q9 same-direction concentration — enforced by default (2026-07-30 crypto cluster session). */
export const GOVERNOR_ENFORCE_CONCENTRATION = envFlag("GOVERNOR_ENFORCE_CONCENTRATION", true);

/** Phase 2c — max aggregate entry premium across open plans (measure-first; enforce opt-in). */
function envPremiumCap(): number {
  const raw = process.env.GOVERNOR_MAX_PREMIUM_AT_RISK?.trim();
  if (!raw) return 500_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500_000;
}
export const GOVERNOR_MAX_PREMIUM_AT_RISK = envPremiumCap();
export const GOVERNOR_ENFORCE_PREMIUM_BUDGET = envFlag("GOVERNOR_ENFORCE_PREMIUM_BUDGET", false);

/** Phase 2c — short-gamma directional exposure cap (dealer-amplifying regime). Measure-first. */
export const GOVERNOR_MAX_SHORT_GAMMA_OPEN = 4;
export const GOVERNOR_ENFORCE_GAMMA_BUDGET = envFlag("GOVERNOR_ENFORCE_GAMMA_BUDGET", false);

/** Phase 2c — time-of-day concurrent cap scaling (lunch chop / opening chop). Enforce opt-in. */
export const GOVERNOR_ENFORCE_TOD_SIZING = envFlag("GOVERNOR_ENFORCE_TOD_SIZING", false);

/** AUDIT SEV-3 realized-loss halt — DISABLED BY DEFAULT (2026-08-27, operator directive: the
 *  system is in a testing/pre-launch phase with no members trading 0DTE aggressively off it yet,
 *  and the operator wants the discovery/commit pipeline to keep producing plays every session
 *  regardless of how many realized losers or how deep the session drawdown gets, rather than go
 *  quiet for the rest of the day). `governorLossHaltReason` (below) still COMPUTES the would-halt
 *  reason/counts unconditionally — the board keeps showing realized_losers/session_pnl_pct/
 *  would_halt as live diagnostics — this flag only controls whether that reason actually BLOCKS a
 *  new commit (evaluateZeroDteGovernor) and contributes to the board's `halted` flag
 *  (summarizeGovernorForBoard). The separate hard-stop-count halt (GOVERNOR_MAX_SESSION_STOPS,
 *  `governor_session_stops`) is UNCHANGED and still enforced unconditionally — it was not part of
 *  this directive. Flip GOVERNOR_ENFORCE_LOSS_HALT=1 to restore the prior always-on behavior. */
export const GOVERNOR_ENFORCE_LOSS_HALT = envFlag("GOVERNOR_ENFORCE_LOSS_HALT", false);

/** The largest same-direction cluster of open plans within a single correlation group, or
 *  null if no two open plans share a group+direction. Pure. Used both by the board measure
 *  and by the per-candidate evaluator, so the "what counts as concentration" logic lives
 *  in ONE place. Caller need not pre-uppercase — tickers are normalized here. */
export function maxCorrelatedSameDirection(
  openPlans: GovernorOpenPlan[]
): { tickers: string[]; direction: "long" | "short"; count: number } | null {
  let best: { tickers: string[]; direction: "long" | "short"; count: number } | null = null;
  for (const group of CORRELATION_GROUPS) {
    for (const direction of ["long", "short"] as const) {
      const inCluster = openPlans
        .filter((p) => p.direction === direction && group.has(p.ticker.toUpperCase()))
        .map((p) => p.ticker.toUpperCase());
      // De-dup tickers so a ledger quirk (two rows same ticker/direction) can't inflate
      // the count — concentration is about distinct correlated exposures.
      const distinct = Array.from(new Set(inCluster));
      if (distinct.length >= 2 && (best == null || distinct.length > best.count)) {
        best = { tickers: distinct.sort(), direction, count: distinct.length };
      }
    }
  }
  return best;
}

/**
 * One row's contribution to session premium-at-risk. For a directional play, `entry_premium`
 * IS the capital at risk (premium paid; worst case ≈ total loss). For a CONDOR, `entry_premium`
 * is stamped as `net_credit` (income RECEIVED, deliberately the SMALL side of the trade —
 * `condor.ts` floors `credit_to_risk` at just 10% of `gross_wing_risk`) so it stays usable as
 * the seller-framed live P&L basis (`condorSellerPnlPct`, `marks-math.ts`) — it cannot also be
 * repurposed as the risk figure without breaking that. The condor's real defined-risk exposure
 * is `max_loss = gross_wing_risk − net_credit`, pinned at commit as `entry_context.condor.max_loss`
 * (same $×100-per-contract unit as `net_credit`, divided by 100 here to match `entry_premium`'s
 * per-share convention). Found 2026-08-28: summing `net_credit` here understated a condor's true
 * worst-case loss by up to ~9-10× at the credit floor — inert today (GOVERNOR_ENFORCE_PREMIUM_BUDGET
 * defaults off, no position sizing wired to any play type yet) but would silently under-budget
 * real exposure the moment either goes live. */
function riskContribution(r: GovernorLedgerRow): number {
  const ec = r.entry_context;
  if (ec?.play_type === "CONDOR") {
    const condor = ec.condor as Record<string, unknown> | null | undefined;
    const maxLoss = typeof condor?.max_loss === "number" ? condor.max_loss : null;
    return maxLoss != null && Number.isFinite(maxLoss) && maxLoss > 0 ? maxLoss / 100 : 0;
  }
  return r.entry_premium != null && Number.isFinite(r.entry_premium) && r.entry_premium > 0 ? r.entry_premium : 0;
}

/** Sum real risk-at-stake across open ledger rows (rounded). Pure. */
export function aggregatePremiumAtRisk(rows: GovernorLedgerRow[]): number {
  let sum = 0;
  for (const r of rows) {
    if (r.status === "CLOSED") continue;
    sum += riskContribution(r);
  }
  return Math.round(sum);
}

/** Count open plans with short-gamma regime pinned at commit. Pure. */
export function countShortGammaOpen(
  rows: Array<Pick<GovernorLedgerRow, "status"> & { entry_context?: Record<string, unknown> | null }>
): number {
  let n = 0;
  for (const r of rows) {
    if (r.status === "CLOSED") continue;
    const ec = r.entry_context;
    const gamma = typeof ec?.gamma_regime === "string" ? ec.gamma_regime.toLowerCase() : "";
    if (gamma.includes("short")) n += 1;
  }
  return n;
}

/** Time-of-day concurrent cap multiplier — lunch/opening chop size-down (Phase 2c). Pure. */
export function timeOfDaySizingFactor(etMinutes: number): {
  factor: number;
  label: string | null;
  effective_max_concurrent: number;
} {
  const tod = timeOfDayFactor(etMinutes);
  let factor = 1;
  if (etMinutes < 10 * 60) factor = 0.85;
  else if (etMinutes >= 12 * 60 + 30 && etMinutes < 13 * 60 + 30) factor = 0.75;
  const effective = Math.max(1, Math.floor(GOVERNOR_MAX_CONCURRENT_PLANS * factor));
  return { factor, label: tod.label, effective_max_concurrent: effective };
}

export function premiumBudgetReason(premiumAtRisk: number): string | null {
  if (!Number.isFinite(premiumAtRisk) || premiumAtRisk < GOVERNOR_MAX_PREMIUM_AT_RISK) return null;
  return (
    `Session governor (MEASURE): aggregate entry premium $${premiumAtRisk.toLocaleString()} at/over ` +
    `$${GOVERNOR_MAX_PREMIUM_AT_RISK.toLocaleString()} budget — further adds over-concentrate capital. ` +
    "Surfaced as calibration evidence, not enforced unless GOVERNOR_ENFORCE_PREMIUM_BUDGET=1."
  );
}

export function gammaBudgetReason(shortGammaOpen: number): string | null {
  if (shortGammaOpen < GOVERNOR_MAX_SHORT_GAMMA_OPEN) return null;
  return (
    `Session governor (MEASURE): ${shortGammaOpen} open short-gamma plays (max ${GOVERNOR_MAX_SHORT_GAMMA_OPEN}) — ` +
    "dealer-amplifying exposure clustered. Surfaced as evidence, not enforced unless GOVERNOR_ENFORCE_GAMMA_BUDGET=1."
  );
}

// ── WS-05: FREEZE the concentration STATE at commit (MEASURE ONLY — no gating) ──────────
// summarizeGovernorForBoard surfaces the concentration measure LIVE on the board, but it is
// re-derived from the CURRENT ledger every build and never pinned to a row. So a graded row
// cannot later be asked "how concentrated was the book WHEN THIS play committed?" — the exact
// question the calibration-first plan needs to answer before flipping concentration from a
// measure to a gate (governor.ts's own Q9 note). This freezes that state onto the committed
// row's entry_context from the SAME inputs the live measure uses (the governor's open plans +
// CORRELATION_GROUPS), so the evidence survives to the graded ledger. STRICTLY EVIDENCE — it
// changes nothing that commits.

/** The immutable concentration snapshot frozen onto a committed row (entry_context.concentration).
 *  Every field is a MEASURE over the book state at commit; back-compat readers must null-guard it
 *  (legacy rows have none). */
export type ZeroDteConcentrationState = {
  /** Existing OPEN plans (this candidate excluded) pointing the SAME direction as the candidate. */
  same_direction_open_count: number;
  /** Existing OPEN plans in the SAME correlation group AND same direction as the candidate — the
   *  same-beta correlated exposure the Q9 measure flags against. */
  same_beta_open_count: number;
  /** Ids of the correlation group(s) the candidate belongs to (v1: the one broad-index/ETF group,
   *  or empty for a single name outside it). */
  correlation_group_ids: string[];
  /** `${ticker}:${direction}` ids of the existing OPEN plans at commit (this candidate excluded) —
   *  the concrete book the counts summarize. */
  existing_open_setup_ids: string[];
  /** Total existing OPEN directional plans at commit (this candidate excluded) — the gross book size. */
  gross_directional_count: number;
  /** Sum of entry premium across the existing OPEN plans at commit, when the caller can supply it
   *  (open ledger rows' entry_premium). Null when unavailable — never fabricated. */
  aggregate_premium_at_risk: number | null;
  /** The version of the concentration definition this state was frozen under (CONCENTRATION_POLICY_VERSION). */
  concentration_policy_version: string;
};

/**
 * Freeze the concentration MEASURE for one committing candidate against the book's OPEN plans —
 * the same `openPlans` + CORRELATION_GROUPS that summarizeGovernorForBoard / maxCorrelatedSameDirection
 * read. PURE, measure-only: it returns evidence to pin, never a gate. Tickers are normalized here; the
 * candidate is excluded from its own counts by ticker. `aggregatePremiumAtRisk` is passed through when
 * the caller has the open rows' entry premiums (the governor's own plan shape carries none), else null.
 */
export function freezeConcentrationState(
  candidate: { ticker: string; direction: "long" | "short" },
  openPlans: GovernorOpenPlan[],
  opts?: { aggregatePremiumAtRisk?: number | null }
): ZeroDteConcentrationState {
  const candTicker = candidate.ticker.toUpperCase();
  // Existing open book with THIS candidate excluded by ticker (a refresh of the same name isn't
  // "another correlated exposure"). Distinct by (ticker, direction) so a ledger quirk can't inflate.
  const existing = Array.from(
    new Map(
      openPlans
        .filter((p) => p.ticker.toUpperCase() !== candTicker)
        .map((p) => [`${p.ticker.toUpperCase()}:${p.direction}`, { ticker: p.ticker.toUpperCase(), direction: p.direction }])
    ).values()
  );

  const sameDirection = existing.filter((p) => p.direction === candidate.direction);
  const group = correlationGroupOf(candTicker);
  const sameBeta = group
    ? sameDirection.filter((p) => group.has(p.ticker))
    : [];

  return {
    same_direction_open_count: sameDirection.length,
    same_beta_open_count: sameBeta.length,
    correlation_group_ids: group ? [correlationGroupId(group)] : [],
    existing_open_setup_ids: existing.map((p) => `${p.ticker}:${p.direction}`).sort(),
    gross_directional_count: existing.length,
    aggregate_premium_at_risk:
      opts?.aggregatePremiumAtRisk != null && Number.isFinite(opts.aggregatePremiumAtRisk)
        ? Math.round(opts.aggregatePremiumAtRisk)
        : null,
    concentration_policy_version: CONCENTRATION_POLICY_VERSION,
  };
}

/** Per-candidate concentration reason (surfaced/measured — the future enforcement point),
 *  or null. Fires when the candidate would JOIN a correlation group in which it already
 *  holds `GOVERNOR_MAX_CORRELATED_SAME_DIR` same-direction open plans (i.e. adding it makes
 *  the cluster exceed the cap). Pure; does NOT push a gate block today — evaluateZeroDte
 *  Governor leaves the board's commits unchanged and the board summary surfaces this as
 *  calibration evidence. Exported so a later enforce-PR can flip it into a block in one line. */
export function concentrationReasonForCandidate(
  candidate: { ticker: string; direction: "long" | "short" },
  liveExposure: GovernorOpenPlan[]
): string | null {
  const candidateTicker = candidate.ticker.toUpperCase();
  const group = correlationGroupOf(candidateTicker);
  if (!group) return null;
  const sameDirCorrelated = new Set(
    liveExposure
      .filter(
        (p) =>
          p.direction === candidate.direction &&
          p.ticker.toUpperCase() !== candidateTicker &&
          group.has(p.ticker.toUpperCase())
      )
      .map((p) => p.ticker.toUpperCase())
  );
  if (sameDirCorrelated.size < GOVERNOR_MAX_CORRELATED_SAME_DIR) return null;
  const held = Array.from(sameDirCorrelated).sort().join(", ");
  return (
    `Session governor (MEASURE): ${candidateTicker} ${candidate.direction} would be the ` +
    `${sameDirCorrelated.size + 1}th same-direction play on correlated index/ETF beta ` +
    `(already open ${candidate.direction}: ${held}) — max ${GOVERNOR_MAX_CORRELATED_SAME_DIR} before ` +
    "this is over-concentration in one direction. Surfaced as calibration evidence, not enforced (Q9)."
  );
}

/** The ledger fields the governor reads — subset so tests need no full row. */
export type GovernorLedgerRow = Pick<
  ZeroDteSetupLogRow,
  | "ticker"
  | "direction"
  | "status"
  | "entry_premium"
  | "trough_premium"
  | "plan_outcome"
  | "plan_pnl_pct"
  // Needed by ledgerRowRealizedPnlPct's third channel — a CLOSED row the lazy grader has not
  // reached yet still knows what it closed at. last_mark_at proves that mark was OBSERVED and
  // not just the seeded entry premium (see db.ts).
  | "last_mark"
  | "last_mark_at"
  // Needed by aggregatePremiumAtRisk to read a condor row's real defined-risk (max_loss),
  // pinned at commit as entry_context.condor.max_loss — entry_premium alone is net_credit for
  // a condor (income received, not risk; see the function's own doc for why they can't be the
  // same field). Required (matches ZeroDteSetupLogRow) — every construction site must now pass
  // entry_context explicitly (null for a row that predates it / a non-condor test fixture).
  | "entry_context"
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

  /**
   * THIRD CHANNEL — a CLOSED row that is neither graded nor a hard stop.
   *
   * Without this the halt was blind to most of a bad day. Live, 2026-08-11: four rows closed red
   * (ACHR −2.3%, RCAT −17.0%, HIMS −29.1%, SPXW −50.0%) and the governor reported
   * `realized_losers: 1, session_pnl_pct: -50` — only SPXW, because only SPXW tripped the −50%
   * stop test. The other three closed on time-stops and their plan_pnl_pct had not been stamped
   * yet, so each contributed exactly 0 to a tally whose entire job is to notice a losing session.
   * The board was already SHOWING −29.1% for HIMS from these same two fields while the governor
   * scored it as nothing.
   *
   * That is fail-OPEN on the risk guard: the 3-loser halt and the −120% session floor both
   * undercount, so the engine keeps committing on a day it has already lost. AUDIT SEV-3 exists
   * precisely to stop that, and lazy grading was letting rows slip past it.
   *
   * GATED ON A REAL OBSERVATION. A row whose quote never arrived keeps last_mark == its seeded
   * entry premium (see db.ts), which would compute a false 0.00% — the manufactured breakeven.
   * last_mark_at proves a quote actually landed; for rows written before that column existed, a
   * mark that DIFFERS from entry is itself proof one did. Neither holds => null, i.e. unknown
   * rather than a fabricated zero.
   */
  if (r.status !== "CLOSED") return null;
  const entry = r.entry_premium;
  const mark = r.last_mark;
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return null;
  if (mark == null || !Number.isFinite(mark)) return null;
  const observed = r.last_mark_at != null || mark !== entry;
  if (!observed) return null;
  return ((mark - entry) / entry) * 100;
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
  candidate: { ticker: string; direction: "long" | "short"; entry_premium?: number | null; gamma_regime?: string | null },
  snap: GovernorSnapshot,
  nowMs: number,
  committedThisCycle: GovernorOpenPlan[] = [],
  opts?: {
    etMinutes?: number;
    premiumAtRisk?: number;
    shortGammaOpen?: number;
  }
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
  // same capital as the 7/13 seven-stop day but through a different exit reason.
  // DISTINCT code `governor_session_loss_halt` (not the hard-stop halt's
  // `governor_session_stops`) so consumers can tell the two halts apart — the
  // hard-stop halt fires on 3 −50% stops, the loss halt fires on 3 realized losers
  // (any exit reason) or cumulative −120% session P&L. Strictly additive.
  const lossHalt = governorLossHaltReason(snap);
  if (GOVERNOR_ENFORCE_LOSS_HALT && lossHalt) {
    blocks.push({
      code: "governor_session_loss_halt",
      reason: lossHalt,
      threshold: GOVERNOR_LOSS_HALT_COUNT,
      unlock_et: null,
    });
    return blocks;
  }

  const liveExposure = [...snap.open_plans, ...committedThisCycle];

  const todSizing =
    opts?.etMinutes != null ? timeOfDaySizingFactor(opts.etMinutes) : null;
  const concurrentCap =
    GOVERNOR_ENFORCE_TOD_SIZING && todSizing
      ? todSizing.effective_max_concurrent
      : GOVERNOR_MAX_CONCURRENT_PLANS;

  if (liveExposure.length >= concurrentCap) {
    blocks.push({
      code: "governor_max_concurrent",
      reason:
        `Session governor: ${liveExposure.length} plans already live (max ` +
        `${concurrentCap} concurrent${todSizing?.label ? ` — ${todSizing.label}` : ""}) — manage what's open before adding exposure.`,
      threshold: concurrentCap,
      unlock_et: null,
    });
  }

  const premiumAtRisk = opts?.premiumAtRisk ?? 0;
  const candidatePremium = candidate.entry_premium ?? 0;
  const premiumReason = premiumBudgetReason(premiumAtRisk + candidatePremium);
  if (GOVERNOR_ENFORCE_PREMIUM_BUDGET && premiumReason) {
    blocks.push({
      code: "governor_premium_budget",
      reason: premiumReason.replace(" (MEASURE)", "").replace(/Surfaced as calibration evidence.*/, "Blocked — premium budget exceeded."),
      threshold: GOVERNOR_MAX_PREMIUM_AT_RISK,
      unlock_et: null,
    });
  }

  const shortGammaOpen = opts?.shortGammaOpen ?? 0;
  const candidateShortGamma =
    typeof candidate.gamma_regime === "string" && candidate.gamma_regime.toLowerCase().includes("short");
  const gammaReason = gammaBudgetReason(shortGammaOpen + (candidateShortGamma ? 1 : 0));
  if (GOVERNOR_ENFORCE_GAMMA_BUDGET && candidateShortGamma && gammaReason) {
    blocks.push({
      code: "governor_gamma_budget",
      reason: gammaReason.replace(" (MEASURE)", "").replace(/Surfaced as evidence.*/, "Blocked — short-gamma exposure cap."),
      threshold: GOVERNOR_MAX_SHORT_GAMMA_OPEN,
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
  if (GOVERNOR_ENFORCE_CONCENTRATION) {
    const conc = concentrationReasonForCandidate(candidate, liveExposure);
    if (conc) {
      blocks.push({
        code: "governor_concentration",
        reason: conc.replace(" (MEASURE)", "").replace(
          "Surfaced as calibration evidence, not enforced (Q9).",
          "Blocked — max correlated same-direction exposure for this session.",
        ),
        threshold: GOVERNOR_MAX_CORRELATED_SAME_DIR,
        unlock_et: null,
      });
    }
  }

  for (const s of snap.stops) {
    if (s.ticker !== ticker || s.direction !== candidate.direction) continue;

    // UNTIMED STOP — fail CLOSED (2026-08-06 audit, P2).
    //
    // WHY: `at_ms` is null for every stop the Redis lane never witnessed live.
    // `deriveGovernorFromLedger` recognises a stop from `plan_outcome === "stopped"` OR the
    // latched trough (`ledgerRowStopped`), while `recordGovernorStops` is only called by
    // scan.ts when THIS process observes the CLOSED/stopped transition in a scan pass. A stop
    // that closed before the replica came up, was stamped later by the lazy grader, or whose
    // Redis twin was lost/evicted therefore stays timeless for the whole session
    // (`mergeGovernorStops` can only upgrade null→timestamp when a twin exists, and
    // `GovernorLedgerRow` deliberately carries no timestamp column to fall back on).
    //
    // The previous `s.at_ms != null &&` guard made that case fail OPEN: the ticker was
    // silently exempt from the re-entry lock — i.e. the governor's loss control was OFF for
    // exactly the stops it had the least information about. Wrong fail direction for a risk
    // device. We still never FABRICATE a timestamp (no invented "stopped N minutes ago"); we
    // state what is actually known — it stopped today, the time is unknown — and hold that
    // ticker+direction for the rest of the session. Bounded by the session (stops are keyed
    // per session_date; the Redis record carries a 24h TTL), scoped to one ticker+direction,
    // and only reachable after a REAL stop, so it cannot strand the board. Reuses the
    // `governor_reentry_lock` code so board/pane labels are unchanged; `threshold: null` is
    // the tell that no timer backs this one.
    if (s.at_ms == null) {
      blocks.push({
        code: "governor_reentry_lock",
        reason:
          `Session governor: ${ticker} ${candidate.direction} stopped out earlier this session ` +
          "but the stop time was never recorded — same-direction re-entry is held for the rest " +
          "of the session (fail-closed: an untimed stop cannot prove the 20-minute lock elapsed).",
        threshold: null,
        unlock_et: null,
      });
      break;
    }

    const elapsedMs = nowMs - s.at_ms;
    if (elapsedMs < GOVERNOR_REENTRY_LOCK_MS) {
      const minsLeft = Math.ceil((GOVERNOR_REENTRY_LOCK_MS - elapsedMs) / 60_000);
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
   *  stop's at_ms + this. A stop with at_ms null gets NO countdown (a time is never
   *  fabricated) but is NOT unlocked either: G-5 fails closed and holds that
   *  ticker+direction for the rest of the session, so render it as "locked (session)"
   *  rather than as an expired/absent lock. */
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
  // ── Q9 same-direction concentration MEASURE (surfaced, NOT enforced) ─────────────
  /** The largest same-direction cluster of open plans within one correlation group
   *  (index/ETF beta), or null if none. Distinct tickers only. A pure measure — it does
   *  NOT gate commits (unlike the enforcing halts above); it is calibration evidence. */
  correlated_concentration: { tickers: string[]; direction: "long" | "short"; count: number } | null;
  /** The same-direction concentration cap the measure flags against (payload number, not
   *  a UI copy). */
  max_correlated_same_dir: number;
  /** A human reason when the current same-direction correlated cluster is at/over the cap
   *  (a further correlated same-direction add would be over-concentration), else null.
   *  SURFACED for the operator + the ledger; NOT reflected in `halted` (measure only, Q9). */
  would_block_concentration: string | null;
  // ── Phase 2c portfolio governor extensions (measure-first) ───────────────────────
  /** Sum of entry premium across open plans. */
  premium_at_risk: number;
  max_premium_at_risk: number;
  would_block_premium_budget: string | null;
  /** Open plans with short-gamma regime at commit. */
  short_gamma_open: number;
  max_short_gamma_open: number;
  would_block_gamma_budget: string | null;
  /** Time-of-day sizing label (lunch chop / prime window). */
  time_of_day_label: string | null;
  /** Effective concurrent cap after time-of-day sizing factor. */
  effective_max_concurrent: number;
  time_of_day_sizing_factor: number;
};

/** Pure: the payload's governor block from today's ledger rows + the recorded
 *  (timestamped) stop events — the exact snapshot evaluateZeroDteGovernor judges. */
export function summarizeGovernorForBoard(
  rows: GovernorLedgerRow[],
  recordedStops: GovernorStopEvent[],
  opts?: {
    etMinutes?: number;
    shortGammaOpen?: number;
  }
): ZeroDteGovernorSummary {
  const snap = deriveGovernorFromLedger(rows);
  const stops = mergeGovernorStops(snap.stops, recordedStops);
  // AUDIT SEV-3 — the realized-loss halt reason keys off the ledger-derived tallies
  // (timestamps don't matter for it), so compute it from `snap`, not the merged stops.
  const wouldHalt = governorLossHaltReason(snap);
  // Q9 — same-direction concentration MEASURE over the open plans. Pure evidence: it is
  // surfaced but never folded into `halted`, so it changes nothing the board commits.
  const concentration = maxCorrelatedSameDirection(snap.open_plans);
  const wouldBlockConcentration =
    concentration != null && concentration.count >= GOVERNOR_MAX_CORRELATED_SAME_DIR
      ? `Session governor (MEASURE): ${concentration.count} same-direction ${concentration.direction} plays ` +
        `on correlated index/ETF beta (${concentration.tickers.join(", ")}) — at/over the ` +
        `${GOVERNOR_MAX_CORRELATED_SAME_DIR}-play concentration ceiling; a further correlated ` +
        `${concentration.direction} add would over-concentrate one direction. Surfaced as evidence, not enforced (Q9).`
      : null;

  const premiumAtRisk = aggregatePremiumAtRisk(rows);
  const shortGammaOpen = opts?.shortGammaOpen ?? 0;
  const todSizing =
    opts?.etMinutes != null ? timeOfDaySizingFactor(opts.etMinutes) : timeOfDaySizingFactor(12 * 60);

  return {
    open_plans: snap.open_plans,
    max_concurrent: GOVERNOR_MAX_CONCURRENT_PLANS,
    stops,
    max_session_stops: GOVERNOR_MAX_SESSION_STOPS,
    // `wouldHalt` only contributes to `halted` when the loss-halt is actually enforced
    // (GOVERNOR_ENFORCE_LOSS_HALT) -- otherwise the board would show "SESSION HALTED" while
    // evaluateZeroDteGovernor keeps accepting new commits underneath, the exact display/reality
    // mismatch PR #2973 fixed for a different field. `would_halt` below still reports the reason
    // as a live diagnostic even when it isn't gating anything.
    halted:
      stops.length >= GOVERNOR_MAX_SESSION_STOPS ||
      (GOVERNOR_ENFORCE_LOSS_HALT && wouldHalt != null),
    reentry_lock_ms: GOVERNOR_REENTRY_LOCK_MS,
    realized_losers: snap.realized_losers ?? 0,
    session_pnl_pct: snap.session_pnl_pct ?? 0,
    loss_halt_count: GOVERNOR_LOSS_HALT_COUNT,
    session_loss_floor_pct: GOVERNOR_SESSION_LOSS_FLOOR_PCT,
    would_halt: wouldHalt,
    correlated_concentration: concentration,
    max_correlated_same_dir: GOVERNOR_MAX_CORRELATED_SAME_DIR,
    would_block_concentration: wouldBlockConcentration,
    premium_at_risk: premiumAtRisk,
    max_premium_at_risk: GOVERNOR_MAX_PREMIUM_AT_RISK,
    would_block_premium_budget: premiumBudgetReason(premiumAtRisk),
    short_gamma_open: shortGammaOpen,
    max_short_gamma_open: GOVERNOR_MAX_SHORT_GAMMA_OPEN,
    would_block_gamma_budget: gammaBudgetReason(shortGammaOpen),
    time_of_day_label: todSizing.label,
    effective_max_concurrent: todSizing.effective_max_concurrent,
    time_of_day_sizing_factor: todSizing.factor,
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

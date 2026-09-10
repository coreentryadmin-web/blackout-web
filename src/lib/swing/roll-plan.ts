// src/lib/swing/roll-plan.ts — builds the ROLL plan (frozen parent grade + gated child leg) the manage-sync
// shell executes (go-live 2026-07-24). This is the seam that makes `closeAndRollSwingPosition` (roll.ts) act on
// a LIVE, real-money position instead of only recording a roll intent.
//
// WHAT A ROLL IS (roll.ts / SWING-ENGINE §4 PR-15): a roll = close+grade the PARENT (terminal ROLLED, realized
// P&L frozen once) + open a linked CHILD (a further-out contract, same thesis). This module supplies the two
// inputs roll.ts needs: (1) the frozen parent grade, and (2) — for a ROLL, not a CLOSE — the child leg spec.
//
// THE GATES (real money — every roll child clears the SAME risk rails as a fresh commit):
//   • ARMED BUDGET — evaluated over (current book MINUS the closing parent PLUS the child). A roll is nearly
//     risk-NEUTRAL (the parent's risk frees as the child's is added), but the child is still checked so a roll
//     into a materially richer contract can't blow the book's heat / event / overnight caps.
//   • BOOK-PERCENT CAPS — the same per-position / theme / total / same-week concentration caps as a commit.
//   • IDEMPOTENCY — the child's commit_key carries the roll GENERATION (`:r{seq}`), so it can never collide
//     with the parent (which would upsert the parent, not open a child) and a re-run lands on the same child.
// NOT re-gated on GRADUATION: a roll continues an ALREADY-authorized thesis on a capital-preservation rung
// (expiry/structural/thesis/premium) — and capital preservation, by the manager's design, never waits on the
// graduation ladder. The parent earned graduation at commit; the roll is a time-in-thesis extension, not a new
// thesis. (Documented deliberate choice — see the PR write-up.)
//
// GRADE-FROM-MARK (bounded, honest): the parent leg is frozen at its realized P&L from the LIVE option mark vs
// its entry premium — the honest realized outcome at roll time, with no forward-bar dependency in the hot cron
// path. `gradeSwingPosition`'s `graded_at IS NULL` guard freezes it exactly once; the EOD multi-truth grader
// never re-litigates a frozen leg. When no live mark is available (null-honest), the roll DEFERS (returns null)
// rather than freezing a fabricated grade — the position stays OPEN and is re-evaluated next tick.
//
// FAIL-SOFT / NULL-HONEST throughout: any missing input (no mark, no chain, no liquid further-out contract, a
// blocked gate) returns null with a logged reason → manage-sync degrades to evidence-only (snapshot + intent,
// no terminal write). A roll NEVER half-executes and NEVER opens risk a gate forbids.

import { explodeChainRows, type PlayDirection, type ChainContract } from "../horizon-fanout";
import type { SwingPositionRow } from "../db";
import type { SwingManageVerdict } from "./manage";
import { decideRollAction, type ParentGradeFreeze, type RollChildSpec } from "./roll";
import type { ManageSyncReads, ManageSyncRollPlan } from "./manage-sync";
import { rankSwingContracts } from "./contract-ranker";
import { SWING_ARCHETYPES, type SwingArchetype, type SwingSubLane } from "./taxonomy";
import {
  modelRiskUsd,
  isEventArchetype,
  swingRollCommitKey,
  type CommitBookPosition,
} from "./commit";
import {
  evaluateSwingCommitBudget,
  DEFAULT_PORTFOLIO_BUDGET,
  type PortfolioBudget,
  type BudgetPosition,
} from "./swing-portfolio-budget";
import { allocateSwingBook, DEFAULT_SWING_CAPS, type SwingCaps, type ExistingSwingPosition } from "./swing-allocation";
import { occFromChainContract } from "./occ-from-row";

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

const VALID_SUB_LANES: ReadonlySet<string> = new Set<SwingSubLane>(["TACTICAL", "STANDARD", "EXTENDED"]);
function coerceSubLane(raw: string | null | undefined): SwingSubLane | null {
  return raw != null && VALID_SUB_LANES.has(raw) ? (raw as SwingSubLane) : null;
}
function coerceArchetype(raw: string | null | undefined): SwingArchetype | null {
  return raw != null && (SWING_ARCHETYPES as readonly string[]).includes(raw) ? (raw as SwingArchetype) : null;
}

/** Everything the roll-plan builder needs, injected so it is testable with fakes (no live DB/providers). */
export interface SwingRollPlanDeps {
  /** Fresh option chain for the child pick — the SAME resolver the discovery cron uses. Fail-soft (→ []). */
  fetchChainRows: (ticker: string) => Promise<Parameters<typeof explodeChainRows>[1]>;
  /** The current live book (budget + caps + idempotency). The closing parent is filtered out internally. */
  book: CommitBookPosition[];
  /** The armed portfolio budget (resolveProductionPortfolioBudget). */
  budget?: PortfolioBudget;
  /** The book-percent caps (defaults to DEFAULT_SWING_CAPS). */
  caps?: SwingCaps;
  /** ET session day (YYYY-MM-DD) — the child's session_date + the DTE as-of + the commit_key. */
  sessionDay: string;
  /** Minimum extra calendar days a child expiry must add over the parent's current DTE (a roll buys TIME). */
  minRollBufferDays?: number;
}

/** Default extra runway a rolled child must carry over the parent's current DTE (never roll flat/nearer). */
export const DEFAULT_MIN_ROLL_BUFFER_DAYS = 2;

/**
 * Which row field actually supplied the mark `gradeParentFromMark` froze the parent grade from, and how
 * stale that observation was. FIX (B) — see the module header's GRADE-FROM-MARK section and
 * `resolveParentGradeMark` below: before this, a fallback to `row.last_mark` was stamped with the exact
 * same `basis: "live_option_mark_vs_entry_premium"` as a genuinely live read, so a reader of `grade_json`
 * (a member, Largo, an auditor) could not tell "graded off THIS tick's live quote" apart from "graded off
 * a latched mark from N minutes/hours ago" — the identical ambiguity `db.ts` (~7140-7156) already
 * documents fixing for 0DTE (RIOT 2026-08-11: closed "breakeven" at a `last_mark` that was never actually
 * re-observed after being seeded, while the contract traded $0.24→$1.48).
 */
export interface ParentMarkSource {
  /** "live_quote" = `reads.mark` this tick; "latched_last_mark" = the ledger's persisted `last_mark`,
   *  used only because the live read missed THIS tick (see `resolveParentGradeMark`). */
  source: "live_quote" | "latched_last_mark";
  /** `row.last_mark_at` as of the freeze — null for a live_quote source (this tick's own read has no
   *  persisted observation instant yet; it IS the current instant). */
  observedAt: string | null;
  /** Age of `observedAt` vs "now" in ms at resolve time — null alongside a null `observedAt`. */
  ageMs: number | null;
}

/** Above this age, a latched `last_mark` is too old to trust for a real-money grade freeze — the roll
 *  DEFERS instead of freezing a stale mark passed off as live (same null-honest philosophy the module
 *  header already documents for a genuinely MISSING mark — see `resolveParentGradeMark`). Sized against
 *  `swing-active-refresh`'s own ~15-min market-hours cadence (cron-registry.ts: schedule_label "Every 15
 *  min (market hours)", stale_after_min 25): a handful of missed ticks (a momentary quote-provider
 *  hiccup, or the FIRST tick after a weekend/holiday gap where today's own live read also happens to
 *  miss) is ordinary cron jitter and still worth trusting; a latch this old means the live quote read has
 *  been failing for HOURS — that is stale evidence, not a frozen truth. */
export const MAX_LATCHED_MARK_AGE_MS = 90 * 60_000; // 90 minutes

/**
 * Resolve which mark to freeze the parent grade from: prefer THIS tick's live read (`liveMark`); fall
 * back to the ledger's latched `row.last_mark` ONLY when that latch is both timestamped and fresh enough
 * (`MAX_LATCHED_MARK_AGE_MS`) to trust for a real-money grade. Returns null when neither is usable — the
 * caller DEFERS, exactly like the pre-existing "no mark at all" case (never freezes a fabricated OR
 * silently-stale-passed-off-as-live grade). Pure + exported so the freshness boundary is unit-tested
 * without a live DB or a wall-clock race (`nowMs` is injectable).
 *
 * `row.last_mark_at` should never be null while `row.last_mark` is non-null in production —
 * `insertSwingPosition` never seeds `last_mark` (only peak/trough seed to entry_premium — see its own
 * comment), and `updateSwingLiveState` stamps `last_mark_at = now()` in the SAME statement as `last_mark`
 * every time a real quote lands — but this fails CLOSED (defers) rather than trusting an un-timestamped
 * latch if that invariant is ever violated, the same fail-closed posture `isMonotonicSwingStatusTransition`
 * takes on an unrecognized status.
 */
export function resolveParentGradeMark(
  row: SwingPositionRow,
  liveMark: number | null | undefined,
  nowMs: number = Date.now(),
): { mark: number; source: ParentMarkSource } | null {
  if (isFin(liveMark) && liveMark >= 0) {
    return { mark: liveMark, source: { source: "live_quote", observedAt: null, ageMs: null } };
  }
  const latched = row.last_mark;
  if (!isFin(latched) || latched < 0) return null;
  if (!row.last_mark_at) return null; // untimestamped latch — fail closed, see doc comment above
  const observedMs = Date.parse(row.last_mark_at);
  if (!Number.isFinite(observedMs)) return null;
  const ageMs = nowMs - observedMs;
  if (ageMs > MAX_LATCHED_MARK_AGE_MS) return null; // too stale to trust — defer, do not freeze
  return { mark: latched, source: { source: "latched_last_mark", observedAt: row.last_mark_at, ageMs } };
}

/** Freeze the parent leg's realized P&L from the live mark vs entry premium. Null when either is unusable
 *  (a roll must never freeze a fabricated grade — it DEFERS instead). Long-option P&L% = (mark−entry)/entry×100.
 *  `markSource` (from `resolveParentGradeMark`) is optional ONLY so direct unit tests can call this with a
 *  raw mark; every real caller supplies it so `grade_json.basis` never claims "live" for a latched mark. */
export function gradeParentFromMark(
  row: SwingPositionRow,
  mark: number | null | undefined,
  markSource?: ParentMarkSource,
): ParentGradeFreeze | null {
  const entry = row.entry_premium;
  if (!isFin(entry) || entry <= 0 || !isFin(mark) || mark < 0) return null;
  const realized = ((mark - entry) / entry) * 100;
  // FIX (B): `basis` now reflects what actually supplied the mark, rather than unconditionally claiming
  // "live" — see ParentMarkSource's doc comment for why a silent claim was dishonest. A direct-call test
  // (no markSource) keeps the old literal `basis` for backward compatibility; every production call site
  // (buildSwingRollPlan below) always passes markSource.
  const basis = !markSource || markSource.source === "live_quote"
    ? "live_option_mark_vs_entry_premium"
    : "latched_last_mark_vs_entry_premium";
  return {
    grade_json: {
      methodology: "swing.roll.markfreeze.v1",
      basis,
      entry_premium: entry,
      exit_mark: mark,
      realized_pnl_pct: realized,
      ...(markSource ? {
        mark_source: markSource.source,
        mark_observed_at: markSource.observedAt,
        mark_age_ms: markSource.ageMs,
      } : {}),
      note: "parent leg frozen at roll time from the live mark; the EOD multi-truth grader never re-litigates a frozen leg (graded_at IS NULL guard)",
    },
    grade_methodology: "swing.roll.markfreeze.v1",
    realized_pnl_pct: realized,
  };
}

/** Map a book position to the budget shape. */
const toBudgetPos = (p: CommitBookPosition): BudgetPosition => ({
  ticker: p.ticker,
  riskUsd: p.riskUsd,
  isEvent: p.isEvent,
  isOvernight: p.isOvernight,
});

/** Map a book position to the allocation shape (weightPct defaults to the per-position cap inside allocate). */
const toExisting = (p: CommitBookPosition): ExistingSwingPosition => ({
  ticker: p.ticker,
  direction: p.direction,
  expiry: p.expiry ?? null,
  weightPct: p.weightPct ?? null,
});

/**
 * Build the roll plan for one held position at a gating rung. Returns:
 *   • null           — DEFER (can't grade the parent, or can't safely build/gate a child) → manage-sync stays
 *                       evidence-only, the parent is left OPEN and re-evaluated next tick;
 *   • {parentGrade}                — a CLOSE (gating rung, thesis broken / no valid roll): grade + close, no child;
 *   • {parentGrade, childSpec}     — a ROLL: grade + close the parent, open the gated child leg.
 * The manage-sync shell hands the result to `closeAndRollSwingPosition`, which owns the transactional write.
 */
export async function buildSwingRollPlan(
  row: SwingPositionRow,
  verdict: SwingManageVerdict,
  reads: ManageSyncReads,
  deps: SwingRollPlanDeps,
): Promise<ManageSyncRollPlan | null> {
  const decision = decideRollAction(verdict);
  if (decision.action === "SKIP") return null; // manage-sync only calls us on a gate, but be defensive.

  // 1. Freeze the parent from the live mark, falling back to the ledger's latched last_mark ONLY when
  //    that latch is fresh enough to trust (resolveParentGradeMark / MAX_LATCHED_MARK_AGE_MS — FIX (B),
  //    see that function's doc comment). No usable mark (live, or latched-but-stale) → DEFER (never a
  //    fabricated OR silently-stale-passed-off-as-live grade). The live option mark is supplied by the
  //    active-refresh reads.
  const resolvedMark = resolveParentGradeMark(row, reads.mark);
  if (!resolvedMark) {
    console.info(`[swing-roll] defer ${row.ticker} #${row.id}: no live mark (or only a stale latched last_mark) to freeze the parent grade`);
    return null;
  }
  const parentGrade = gradeParentFromMark(row, resolvedMark.mark, resolvedMark.source);
  if (!parentGrade) {
    console.info(`[swing-roll] defer ${row.ticker} #${row.id}: no live mark to freeze the parent grade`);
    return null;
  }

  // 2. CLOSE (thesis broken / no valid roll): grade + close the parent, no child leg.
  if (decision.action === "CLOSE") {
    return { parentGrade };
  }

  // 3. ROLL: build + gate the child leg. Any block → DEFER (parent stays OPEN, never rolled into nothing).
  const built = await buildRollChild(row, reads, deps);
  if ("blocked" in built) {
    console.info(`[swing-roll] defer ROLL ${row.ticker} #${row.id}: ${built.blocked.join(", ")}`);
    return null;
  }
  return { parentGrade, childSpec: built.childSpec };
}

/** Pick + gate the further-out child contract for a ROLL. Returns the child spec or the block reasons. */
async function buildRollChild(
  row: SwingPositionRow,
  reads: ManageSyncReads,
  deps: SwingRollPlanDeps,
): Promise<{ childSpec: RollChildSpec } | { blocked: string[] }> {
  const budget = deps.budget ?? DEFAULT_PORTFOLIO_BUDGET;
  const caps = deps.caps ?? DEFAULT_SWING_CAPS;
  const buffer = isFin(deps.minRollBufferDays) ? deps.minRollBufferDays : DEFAULT_MIN_ROLL_BUFFER_DAYS;

  const direction: PlayDirection = row.direction === "short" ? "SHORT" : "LONG";
  const dirLc: "long" | "short" = row.direction === "short" ? "short" : "long";
  const subLane = coerceSubLane(row.sub_lane);
  const underlyingPx = reads.underlyingPrice;
  if (!subLane) return { blocked: ["no_sub_lane"] };
  if (!isFin(underlyingPx)) return { blocked: ["no_underlying_spot"] };

  const chainRows = await deps.fetchChainRows(row.ticker).catch(() => [] as Parameters<typeof explodeChainRows>[1]);
  if (!chainRows || chainRows.length === 0) return { blocked: ["no_chain"] };

  const contracts = explodeChainRows(row.ticker, chainRows, deps.sessionDay, direction);
  const ranking = rankSwingContracts(contracts, subLane, direction, underlyingPx, { topFlowStrike: row.top_flow_strike });
  const pick: ChainContract | null = ranking.pick;
  if (!pick) return { blocked: ["no_liquid_child_contract"] };

  // A roll must buy TIME: the child expiry has to be strictly further out than the parent's current DTE (+buffer).
  // Fail closed when parent DTE is unknown — every other missing input in this function blocks; skipping the
  // check when reads.dte is null/NaN would accept a flat/nearer child without verification (CTO audit #25).
  const parentDte = reads.dte;
  if (!isFin(parentDte)) return { blocked: ["no_parent_dte"] };
  if (!(pick.dte > parentDte + buffer)) {
    return { blocked: [`child_not_further_out (child ${pick.dte}dte <= parent ${parentDte}dte + ${buffer})`] };
  }

  const premium = pick.mid;
  const riskUsd = modelRiskUsd(premium);
  if (!isFin(riskUsd)) return { blocked: ["unknown_child_premium"] };

  const archetype = coerceArchetype(row.archetype);
  const childKey = swingRollCommitKey(deps.sessionDay, row.ticker, subLane, dirLc, (row.roll_seq ?? 0) + 1, archetype);

  // IDEMPOTENCY: a child under this generation's key already open → the roll already happened; do not re-roll.
  if (deps.book.some((p) => p.commitKey === childKey)) return { blocked: ["already_rolled"] };

  // The parent is CLOSING as part of this roll, so its risk/weight frees — evaluate the child against the book
  // WITHOUT the parent (a roll is near risk-neutral; this stops the parent double-counting against the caps).
  const bookMinusParent = deps.book.filter((p) => p.commitKey !== row.commit_key);

  // ARMED BUDGET gate.
  const candBudget: BudgetPosition = { ticker: row.ticker, riskUsd, isEvent: isEventArchetype(archetype), isOvernight: true };
  const bv = evaluateSwingCommitBudget(bookMinusParent.map(toBudgetPos), candBudget, budget);
  if (bv.blocked) return { blocked: bv.blockedDimensions.map((d) => `budget:${d}`) };

  // BOOK-PERCENT CAPS gate (neutral score — a single candidate's cap flags are score-independent).
  const alloc = allocateSwingBook(
    [{ ticker: row.ticker, direction, score: 50, expiry: pick.expiry }],
    bookMinusParent.map(toExisting),
    caps,
  );
  const capBreaches = (alloc.decisions[0]?.capFlags ?? []).filter((f) => f.wouldBreach).map((f) => `cap:${f.cap}`);
  if (capBreaches.length > 0) return { blocked: capBreaches };

  const childSpec: RollChildSpec = {
    commit_key: childKey,
    session_date: deps.sessionDay,
    ticker: row.ticker.trim().toUpperCase(),
    direction: dirLc,
    sub_lane: subLane,
    archetype,
    top_flow_strike: row.top_flow_strike,
    contract_strike: isFin(pick.strike) ? pick.strike : null,
    contract_expiry: pick.expiry,
    contract_type: pick.right === "C" ? "call" : "put",
    contract_occ: occFromChainContract({
      ticker: row.ticker,
      expiry: pick.expiry,
      right: pick.right,
      strike: pick.strike,
    }),
    contract_delta: isFin(pick.delta) ? pick.delta : null,
    entry_underlying_px: underlyingPx,
    thesis_invalidation_px: row.thesis_invalidation_px,
    target_underlying_px: row.target_underlying_px,
    entry_premium: premium,
    entry_context: {
      commit_gate: "swing.roll.child.v1",
      rolled_from_position_id: row.id,
      roll_seq: (row.roll_seq ?? 0) + 1,
      risk_usd: riskUsd,
      model_contracts: 1,
      is_event: isEventArchetype(archetype),
      is_overnight: true,
    },
    status: "OPEN",
  };

  // Grow the CALLER's book in place — swap the closing parent for the new child — so a LATER position's
  // roll-gate check in the SAME active-refresh pass sees this child's risk instead of a stale snapshot taken
  // once at the top of the run (FINDINGS 2026-08-06 P1). Mirrors commit.ts's `runningBook` growth across a
  // commit batch: without this, two same-pass rolls both gate against a book that reflects NEITHER addition,
  // so their combined risk could clear each roll's individual budget/cap check while breaching it in
  // aggregate. Swapping (not just pushing) keeps the running book precise — it matches exactly what
  // `bookMinusParent` + child just evaluated above, rather than double-counting this ticker's now-closing
  // parent leg alongside its child for the rest of the pass.
  const parentIdx = deps.book.findIndex((p) => p.commitKey === row.commit_key);
  if (parentIdx >= 0) deps.book.splice(parentIdx, 1);
  deps.book.push({
    ticker: childSpec.ticker,
    direction,
    archetype,
    commitKey: childKey,
    riskUsd,
    isEvent: isEventArchetype(archetype),
    isOvernight: true,
    expiry: childSpec.contract_expiry,
  });

  return { childSpec };
}

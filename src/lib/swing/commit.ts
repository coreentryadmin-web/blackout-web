// src/lib/swing/commit.ts — THE live commit gate for the swing lane (go-live 2026-07-24). Pure decision +
// a thin ledger executor. This is the ONE place a WATCH candidate becomes a REAL open position.
//
// WHY (docs/audit/SWING-ENGINE.md §6.5 — "Commit authorization"): every earlier swing PR shipped the lane
// evidence-only (`commitEligibleCount` a literal 0). Discovery accretes cross-session persistence and serves a
// WATCH rail; the calibration ladder (calibration.ts) grades a track record but only RETURNS verdicts. Nothing
// opened a position. This module wires the last mile — and it opens REAL MONEY, so it is gated three ways and
// every gate must pass:
//
//   1. ARMED BUDGET (swing-portfolio-budget.ts). The candidate, added to the CURRENT live book, must not push
//      any portfolio-risk dimension it contributes to into HARD over-limit (2% per-trade / 6% total heat /
//      3% event / 4% overnight of the $100k reference account). See `evaluateSwingCommitBudget`.
//   2. BOOK-PERCENT CAPS (swing-allocation.ts). Orthogonal %-of-member-book concentration: per-position 5% /
//      per-theme 20% / total-in-swings 40% / max-3-same-week-expiry. A candidate whose inclusion breaches a
//      cap is skipped.
//   3. IDEMPOTENCY (commit_key). A stable `${session}:${TICKER}:${SUBLANE}:${dir}` key — a name already open
//      on the book under that key is NEVER re-opened (and `insertSwingPosition` upserts on it as a DB backstop).
//
// GRADUATION IS EVIDENCE-ONLY, NOT A GATE (2026-08-06, member-authorized — matches the 0DTE calibration
// philosophy in zerodte/calibration.ts: "CALIBRATION mode: they never block, they only pin a would-block
// bucket... thresholds graduate on evidence, never on vibes"). Before this change, gate 1 required a
// candidate's archetype×sub-lane bucket to have cleared the staged Wilson-LB ladder (n>=30 graded rows,
// >=60% lower-bound win rate) before ANY position could open — a structural cold-start deadlock: with zero
// opens, no graded history ever accumulates, so no bucket could ever graduate, so nothing could ever open.
// 0DTE never made this mistake — its calibration gates (G-4 VIX, G-6 conflict) trade in real time on the
// core signal engine from day one, and only ADD enforcement once THEY individually earn it; they never
// require the whole engine to earn the right to trade at all. `isCommitGraduated` is unchanged and still
// computed + pinned into every ledger row (`entry_context.graduated` / `gate_calibration_json.graduated`,
// both now the REAL boolean, never hardcoded true) so graduation status stays fully observable and the
// calibration ladder keeps grading real trades going forward — it simply no longer blocks the open. The
// three gates above (budget / caps / idempotency) are real-time risk controls, unchanged and unweakened.
//
// SIZING (the reference-lot model): the ledger row is a MODEL position of ONE reference contract; members size
// it to their own capital at serve time (the whole reason swing-allocation.ts caps are %-of-member-book, not $).
// So the budget's dollar risk = the debit of one long contract = `entry_premium × 100` (a long option's max
// loss IS the premium paid). No contract-count is invented or stored; the reference lot keeps the risk math
// honest and queryable. A contract too rich for the per-trade cap (premium×100 > 2% of the reference account)
// is blocked by the per-position budget dimension — the honest "too expensive for a 2% risk slice" verdict.
//
// PURE / OBSERVABLE: `computeSwingCommitPlan` is pure and deterministic — it walks candidates best-first,
// grows a running book so the budget/caps aggregate correctly across the batch, and returns a decision per
// candidate carrying `blockedBy` reasons (queryable). `executeSwingCommits` is the thin fail-soft IO shell
// that writes the graduated+cleared rows through injected accessors (no live DB in tests).

import type { PlayDirection, ChainContract } from "../horizon-fanout";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import { subLaneForDte } from "./taxonomy";
import { occFromChainContract } from "./occ-from-row";
import { swingThesisKey } from "./accumulation-store";
import type { SwingCalibrationReport } from "./calibration";
import type { SwingPillarSignals } from "./swing-pillars";
import { buildSwingFeatureVector } from "./feature-vector";
import {
  evaluateSwingCommitBudget,
  DEFAULT_PORTFOLIO_BUDGET,
  type PortfolioBudget,
  type BudgetPosition,
  type SwingCommitBudgetVerdict,
} from "./swing-portfolio-budget";
import {
  allocateSwingBook,
  DEFAULT_SWING_CAPS,
  type SwingCaps,
  type ExistingSwingPosition,
} from "./swing-allocation";
import type { SwingPositionInsert } from "../db";

/** Shares per option contract — the standard US equity-option multiplier. */
export const OPTION_CONTRACT_MULTIPLIER = 100;

/**
 * The archetypes whose exposure counts against the EVENT budget dimension. The operator specified EVENT_DRIVEN
 * and POST_EARNINGS_DRIFT (catalyst/earnings names); FAILED_BREAKDOWN is a structural reclaim, not an
 * earnings/catalyst event, so it does NOT count as event exposure (it is still overnight, like every swing).
 */
export const EVENT_EXPOSURE_ARCHETYPES: readonly SwingArchetype[] = ["EVENT_DRIVEN", "POST_EARNINGS_DRIFT"];
export function isEventArchetype(a: SwingArchetype | null | undefined): boolean {
  return a != null && (EVENT_EXPOSURE_ARCHETYPES as readonly string[]).includes(a);
}

/** Max-loss debit of ONE reference long-option contract = premium/share × 100, rounded to cents (a dollar risk
 *  figure — round at the data layer, never carry IEEE754 dust like 509.99999999999994). Null when unknown. */
export function modelRiskUsd(entryPremiumPerShare: number | null | undefined): number | null {
  if (entryPremiumPerShare == null || !Number.isFinite(entryPremiumPerShare) || entryPremiumPerShare <= 0) return null;
  return Math.round(entryPremiumPerShare * OPTION_CONTRACT_MULTIPLIER * 100) / 100;
}

/**
 * GRADUATION gate: has this candidate's archetype×sub-lane bucket cleared the staged Wilson-LB ladder?
 * BOTH the archetype floor AND the sub-lane floor must have graduated (the conservative reading, using the
 * shipped `analyzeArchetypeRecord`/`analyzeSubLaneRecord` verdicts unchanged). A null archetype or sub-lane, or
 * a null/empty report, is NEVER graduated — an unclassified name or a lane with no graded record has not
 * earned live sizing. Returns the reason so the block is explainable.
 */
export function isCommitGraduated(
  report: SwingCalibrationReport | null | undefined,
  archetype: SwingArchetype | null,
  subLane: SwingSubLane | null,
): { graduated: boolean; reason: string } {
  if (!report) return { graduated: false, reason: "no calibration report (no graded history) — nothing graduated" };
  if (archetype == null) return { graduated: false, reason: "unclassified archetype — no graduated bucket" };
  if (subLane == null) return { graduated: false, reason: "no resolved sub-lane — no graduated bucket" };
  const arch = report.archetype_floors.find((g) => g.archetype === archetype);
  const lane = report.sub_lane_floors.find((g) => g.subLane === subLane);
  const archOk = arch?.floorGraduated === true;
  const laneOk = lane?.floorGraduated === true;
  if (archOk && laneOk) {
    return { graduated: true, reason: `archetype ${archetype} + sub-lane ${subLane} floors graduated` };
  }
  const missing = [!archOk ? `archetype ${archetype}` : null, !laneOk ? `sub-lane ${subLane}` : null]
    .filter(Boolean)
    .join(" + ");
  return { graduated: false, reason: `not graduated: ${missing} floor(s) below the staged Wilson-LB bar` };
}

/** A WATCH candidate offered to the commit gate — the persistence bar is ALREADY cleared upstream (discovery). */
export interface SwingCommitCandidate {
  ticker: string;
  /** Directional side — a commit needs one (structure-only, direction-null names are not committable). */
  direction: PlayDirection | null;
  archetype: SwingArchetype | null;
  /** The dossier's INTENDED sub-lane (from the intended DTE). Graduation reads the TRADED contract's lane when a
   *  contract is attached, else falls back to this — so a graduated name with no liquid contract still counts as
   *  eligible (then blocked by no_contract), keeping `commitEligibleCount` the honest graduated count. */
  subLane: SwingSubLane | null;
  /** The dossier evidence score (ranks the batch; pinned into entry_context). */
  score: number;
  /** The concrete SWING contract picked for this name (playSet.SWING), or null when no liquid contract. */
  contract: ChainContract | null;
  /** ET session day (YYYY-MM-DD) — the commit_key + ledger session_date. */
  sessionDate: string;
  /** Underlying-terms plan levels (from the dossier/gate), pinned onto the ledger row. Each null-safe. */
  entryUnderlyingPx?: number | null;
  thesisInvalidationPx?: number | null;
  targetUnderlyingPx?: number | null;
  topFlowStrike?: number | null;
  // ── Feature-vector static thesis part (pinned at commit; echoed on every snapshot) ──
  pillars?: SwingPillarSignals | null;
  presentPillars?: number | null;
  dataQualityDegraded?: boolean | null;
  archetypeSecondary?: SwingArchetype[] | null;
  archetypeScores?: Record<string, number> | null;
  classificationMargin?: number | null;
  /** UW IV rank (0–100) when known at commit — honest null otherwise; first refresh tick can fill it. */
  ivRank?: number | null;
}

/** A live-book position the commit gate reads for budget + caps + idempotency. */
export interface CommitBookPosition {
  ticker: string;
  direction: PlayDirection;
  /** Thesis archetype on the open leg — idempotency is one open root per (name, side, archetype). */
  archetype?: string | null;
  commitKey: string;
  /** Its max-loss debit for the budget aggregate (null ⇒ contributes 0 — never a fabricated risk). */
  riskUsd?: number | null;
  isEvent?: boolean;
  isOvernight?: boolean;
  /** Option expiry (same-week cap) + current book weight % (allocation caps; defaults to per-position cap). */
  expiry?: string | null;
  weightPct?: number | null;
}

export interface SwingCommitDecision {
  ticker: string;
  direction: PlayDirection | null;
  archetype: SwingArchetype | null;
  subLane: SwingSubLane | null;
  commitKey: string;
  /** Whether this candidate's archetype×sub-lane bucket has cleared the calibration ladder — EVIDENCE ONLY
   *  (see the file header), pinned for observability and counted into `commitEligibleCount`. Does NOT gate
   *  `committable` below — an ungraduated candidate commits exactly like a graduated one. */
  graduated: boolean;
  /** Passed EVERY real-time gate (contract ∧ budget ∧ caps ∧ idempotency) → will open a real position. */
  committable: boolean;
  /** The reference-lot dollar risk (premium×100), or null when unknown. */
  riskUsd: number | null;
  /** Every gate this candidate failed (queryable reasons): no_contract / unknown_premium / no_direction /
   *  already_open / budget:<dim> / cap:<code>. Empty ⇒ committable. */
  blockedBy: string[];
  reason: string;
  /** The armed-budget verdict over (book + candidate) — surfaced verbatim for the queryable reason. */
  budget?: SwingCommitBudgetVerdict;
  /** The ledger row to write — present ONLY when committable. */
  insert?: SwingPositionInsert;
}

export interface SwingCommitPlan {
  decisions: SwingCommitDecision[];
  /** WATCH candidates whose bucket GRADUATED — a diagnostic count (calibration ladder progress), no longer
   *  a prerequisite for `committableCount` below (graduation is evidence-only, see the file header). */
  commitEligibleCount: number;
  /** How many candidates cleared budget + caps + idempotency + contract → actually open, REGARDLESS of
   *  graduation status. */
  committableCount: number;
  /** The armed budget the plan gated against (echoed for observability). */
  budget: PortfolioBudget;
}

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

/** Stable idempotency key: one per (session, name, sub-lane, side). Matches the ledger's commit_key format. */
export function swingCommitKey(sessionDate: string, ticker: string, subLane: SwingSubLane, dir: "long" | "short"): string {
  return `${sessionDate}:${ticker.trim().toUpperCase()}:${subLane}:${dir}`;
}

/** Idempotency key for a ROLL child — the base key plus the roll generation (`:r{seq}`), so a child NEVER
 *  collides with its parent's commit_key (which would upsert the parent instead of opening a new leg) and a
 *  re-run of the same roll generation lands on the SAME child row. */
export function swingRollCommitKey(
  sessionDate: string,
  ticker: string,
  subLane: SwingSubLane,
  dir: "long" | "short",
  rollSeq: number,
): string {
  return `${swingCommitKey(sessionDate, ticker, subLane, dir)}:r${Math.max(1, Math.floor(rollSeq))}`;
}

/**
 * PURE: decide which WATCH candidates commit. Walks candidates best-first (score desc, ticker tie-break),
 * carrying a RUNNING book that grows with each approval so the armed budget and the book-percent caps
 * aggregate correctly across the batch (committing the 1st same-theme name tightens the 2nd's theme cap).
 * Every candidate yields a decision with `graduated`/`committable`/`blockedBy`; nothing is opened here — the
 * executor writes the `insert` rows. Deterministic on fixed inputs.
 */
export function computeSwingCommitPlan(args: {
  candidates: SwingCommitCandidate[];
  report: SwingCalibrationReport | null;
  book: CommitBookPosition[];
  budget?: PortfolioBudget;
  caps?: SwingCaps;
}): SwingCommitPlan {
  const budget = args.budget ?? DEFAULT_PORTFOLIO_BUDGET;
  const caps = args.caps ?? DEFAULT_SWING_CAPS;
  const report = args.report ?? null;

  // Best-first so scarce budget/cap room goes to the strongest evidence; ticker tie-break = deterministic.
  const ordered = [...args.candidates].sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));

  // Running book (existing + everything approved so far). Idempotency keys on thesis identity
  // (ticker, direction, archetype) — not the session-scoped commit_key and not name+side alone (a
  // different archetype on the same name+side is a different thesis). A roll child on the same thesis
  // is correctly seen as "already open" so discovery never stacks a duplicate on a live roll chain.
  const runningBook: CommitBookPosition[] = [...args.book];
  const openThesis = new Set(
    args.book.map((p) => swingThesisKey(p.ticker, p.direction, p.archetype ?? null)),
  );

  const decisions: SwingCommitDecision[] = [];
  let commitEligibleCount = 0;
  let committableCount = 0;

  for (const cand of ordered) {
    const ticker = cand.ticker.trim().toUpperCase();
    const dirLc: "long" | "short" | null = cand.direction === "LONG" ? "long" : cand.direction === "SHORT" ? "short" : null;
    // The TRADED sub-lane is the picked contract's DTE lane (what actually gets managed/graded); the ledger row
    // and commit_key use it. Graduation reads the traded lane when present, else the dossier's intended lane —
    // so a graduated name with no liquid contract is still counted eligible (then blocked by no_contract).
    const subLane: SwingSubLane | null = cand.contract ? subLaneForDte(cand.contract.dte) : null;
    const gradeSubLane: SwingSubLane | null = subLane ?? cand.subLane;
    const commitKey = subLane && dirLc ? swingCommitKey(cand.sessionDate, ticker, subLane, dirLc) : `${cand.sessionDate}:${ticker}:_:_`;

    const grad = isCommitGraduated(report, cand.archetype, gradeSubLane);
    const blockedBy: string[] = [];
    const riskUsd = modelRiskUsd(cand.contract?.mid ?? null);

    // GRADUATION is evidence-only (see the file header) — pinned for observability, never gates the open.
    // commitEligibleCount keeps its original meaning (the count that has cleared the calibration ladder) as
    // a diagnostic, not as a prerequisite for committableCount below.
    if (grad.graduated) commitEligibleCount += 1;

    // Gate 0.5 — open-ability: a real entry needs a direction, a contract, and a known premium.
    if (dirLc == null) blockedBy.push("no_direction");
    if (!cand.contract) blockedBy.push("no_contract");
    else if (!isFin(riskUsd)) blockedBy.push("unknown_premium");
    if (subLane == null) blockedBy.push("no_sub_lane");

    // Gate 3 — IDEMPOTENCY: never double-open a thesis that already has a live root on the book.
    const thesisKey = swingThesisKey(ticker, cand.direction as PlayDirection, cand.archetype);
    if (dirLc && openThesis.has(thesisKey)) blockedBy.push("already_open");

    // Gate 1 — ARMED BUDGET (only meaningful once we have a risk number).
    let budgetVerdict: SwingCommitBudgetVerdict | undefined;
    if (isFin(riskUsd) && cand.contract && dirLc) {
      const candBudget: BudgetPosition = {
        ticker,
        riskUsd,
        isEvent: isEventArchetype(cand.archetype),
        isOvernight: true, // every swing is held overnight by definition
      };
      budgetVerdict = evaluateSwingCommitBudget(
        runningBook.map((p) => ({ ticker: p.ticker, riskUsd: p.riskUsd, isEvent: p.isEvent, isOvernight: p.isOvernight })),
        candBudget,
        budget,
      );
      if (budgetVerdict.blocked) for (const d of budgetVerdict.blockedDimensions) blockedBy.push(`budget:${d}`);
    }

    // Gate 2 — BOOK-PERCENT CAPS. Run allocation over the running book + this candidate; a SKIP = a breached cap.
    if (cand.contract && dirLc) {
      const existing: ExistingSwingPosition[] = runningBook.map((p) => ({
        ticker: p.ticker, direction: p.direction, expiry: p.expiry ?? null, weightPct: p.weightPct ?? null,
      }));
      const alloc = allocateSwingBook(
        [{ ticker, direction: cand.direction as PlayDirection, score: cand.score, expiry: cand.contract.expiry }],
        existing,
        caps,
      );
      const decision = alloc.decisions[0];
      if (decision) for (const f of decision.capFlags) if (f.wouldBreach) blockedBy.push(`cap:${f.cap}`);
    }

    const committable = blockedBy.length === 0 && cand.contract != null && dirLc != null && subLane != null && isFin(riskUsd);
    let insert: SwingPositionInsert | undefined;
    if (committable && cand.contract && dirLc && subLane) {
      insert = buildCommitInsert(cand, subLane, dirLc, commitKey, riskUsd as number, grad, budget, budgetVerdict);
      committableCount += 1;
      openThesis.add(thesisKey);
      runningBook.push({
        ticker, direction: cand.direction as PlayDirection, archetype: cand.archetype, commitKey, riskUsd,
        isEvent: isEventArchetype(cand.archetype), isOvernight: true, expiry: cand.contract.expiry,
      });
    }

    decisions.push({
      ticker, direction: cand.direction, archetype: cand.archetype, subLane, commitKey,
      graduated: grad.graduated, committable, riskUsd, blockedBy,
      reason: committable
        ? `COMMIT: ${grad.graduated ? grad.reason : "not yet graduated — evidence-only, real-time gates cleared"}; risk $${(riskUsd as number).toFixed(0)} cleared budget + caps`
        : `blocked by ${blockedBy.join(", ")}`,
      budget: budgetVerdict,
      insert,
    });
  }

  return { decisions, commitEligibleCount, committableCount, budget };
}

/** Build the ledger row for a committable candidate. Pins the commit-gate evidence into entry_context /
 *  gate_calibration_json so WHY it committed (graduation + risk + budget) is durable + queryable. */
function buildCommitInsert(
  cand: SwingCommitCandidate,
  subLane: SwingSubLane,
  dirLc: "long" | "short",
  commitKey: string,
  riskUsd: number,
  grad: { graduated: boolean; reason: string },
  budget: PortfolioBudget,
  budgetVerdict: SwingCommitBudgetVerdict | undefined,
): SwingPositionInsert {
  const c = cand.contract!;
  return {
    commit_key: commitKey,
    session_date: cand.sessionDate,
    ticker: cand.ticker.trim().toUpperCase(),
    direction: dirLc,
    sub_lane: subLane,
    archetype: cand.archetype,
    top_flow_strike: cand.topFlowStrike ?? null,
    contract_strike: isFin(c.strike) ? c.strike : null,
    contract_expiry: c.expiry ?? null,
    contract_type: c.right === "C" ? "call" : "put",
    // Reconstruct OCC at commit so active-refresh can load live marks (premium_stop / rolls / ladder).
    contract_occ: occFromChainContract({
      ticker: cand.ticker,
      expiry: c.expiry,
      right: c.right,
      strike: c.strike,
    }),
    contract_delta: isFin(c.delta) ? c.delta : null,
    entry_underlying_px: cand.entryUnderlyingPx ?? null,
    thesis_invalidation_px: cand.thesisInvalidationPx ?? null,
    target_underlying_px: cand.targetUnderlyingPx ?? null,
    entry_premium: isFin(c.mid) ? c.mid : null,
    entry_context: {
      commit_gate: "swing.commit.v1",
      graduated: grad.graduated,
      graduation_reason: grad.reason,
      score: cand.score,
      risk_usd: riskUsd,
      model_contracts: 1,
      contract_multiplier: OPTION_CONTRACT_MULTIPLIER,
      is_event: isEventArchetype(cand.archetype),
      is_overnight: true,
      budget: {
        capitalUsd: budget.capitalUsd,
        maxPortfolioLossPct: budget.maxPortfolioLossPct,
        perPositionLossPct: budget.perPositionLossPct,
        eventExposureCap: budget.eventExposureCap,
        overnightCap: budget.overnightCap,
        enforce: budget.enforce,
      },
      budget_verdict: budgetVerdict ? { blocked: budgetVerdict.blocked, blockedDimensions: budgetVerdict.blockedDimensions } : null,
    },
    gate_calibration_json: {
      methodology: "swing.commit.graduation.v1",
      archetype: cand.archetype,
      sub_lane: subLane,
      graduated: grad.graduated,
      reason: grad.reason,
    },
    // Pin the static thesis feature vector at commit so trajectory studies can echo pillars/score on
    // every later snapshot (manage-sync reads this via staticSwingFeatureInputsFromPinned).
    feature_vector: buildSwingFeatureVector({
      ticker: cand.ticker,
      direction: dirLc,
      archetype: cand.archetype,
      subLane,
      evidenceScore: cand.score,
      presentPillars: cand.presentPillars ?? null,
      dataQualityDegraded: cand.dataQualityDegraded ?? null,
      pillars: cand.pillars ?? null,
      archetypeSecondary: cand.archetypeSecondary ?? null,
      archetypeScores: cand.archetypeScores ?? null,
      classificationMargin: cand.classificationMargin ?? null,
      ivRank: cand.ivRank ?? null,
      snapshotKind: "commit",
      snapshotSeq: 0,
      sessionsElapsed: 0,
    }) as unknown as Record<string, unknown>,
    status: "OPEN",
  };
}

// ─── Executor (thin IO shell) ──────────────────────────────────────────────────────────────────────

export interface SwingCommitDeps {
  /** Open the position (db.insertSwingPosition — upserts on commit_key, first-write-wins). Returns the id. */
  insertPosition: (pos: SwingPositionInsert) => Promise<number>;
  /** Link the accumulation thesis to the position it promoted into (db.markAccumPromoted via the store).
   *  Best-effort: a link failure is logged but does NOT undo the (already durable) commit.
   *  Archetype is required so a sibling thesis on the same name+side is not falsely retired. */
  promote?: (
    ticker: string,
    direction: PlayDirection,
    positionId: number,
    archetype?: string | null,
  ) => Promise<void>;
}

export interface SwingCommitExecEntry {
  ticker: string;
  direction: PlayDirection;
  commitKey: string;
  positionId: number | null;
  error?: string;
}

export interface SwingCommitResult {
  committed: SwingCommitExecEntry[];
  /** Non-committable decisions carried through for the cron log (ticker + why). */
  skipped: Array<{ ticker: string; commitKey: string; blockedBy: string[] }>;
  errors: number;
}

/**
 * Execute the committable decisions: open each position, then link its accumulation candidate. FAIL-SOFT per
 * position — one insert error is caught + tallied, never aborts the batch. Idempotent: `insertSwingPosition`
 * upserts on commit_key, so a re-run lands on the same row (no double-open) even if this is retried.
 */
export async function executeSwingCommits(deps: SwingCommitDeps, plan: SwingCommitPlan): Promise<SwingCommitResult> {
  const committed: SwingCommitExecEntry[] = [];
  let errors = 0;
  const skipped = plan.decisions
    .filter((d) => !d.committable)
    .map((d) => ({ ticker: d.ticker, commitKey: d.commitKey, blockedBy: d.blockedBy }));

  for (const d of plan.decisions) {
    if (!d.committable || !d.insert || !d.direction) continue;
    try {
      const positionId = await deps.insertPosition(d.insert);
      if (deps.promote) {
        try {
          await deps.promote(d.ticker, d.direction, positionId, d.archetype);
        } catch (err) {
          // Linking is best-effort — the position is already open + durable; a failed link only risks the
          // candidate re-surfacing (harmless: the commit_key upsert prevents a second open).
          console.error(`[swing-commit] promote link failed for ${d.ticker} (position ${positionId})`, err);
        }
      }
      committed.push({ ticker: d.ticker, direction: d.direction, commitKey: d.commitKey, positionId });
    } catch (err) {
      errors += 1;
      committed.push({
        ticker: d.ticker, direction: d.direction, commitKey: d.commitKey, positionId: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { committed, skipped, errors };
}

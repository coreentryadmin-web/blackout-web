// src/lib/swing/swing-portfolio-budget.ts — advisory PORTFOLIO-BUDGET scaffold for the swing book.
//
// WHY THIS EXISTS (and why it ships DISARMED):
// The book-percent caps in swing-allocation.ts answer "is this ONE position too big / is this ONE
// theme too concentrated?" as a fraction of each member's own capital. They deliberately carry NO
// absolute dollar figure. This module is the SECOND, orthogonal dimension: a whole-portfolio RISK
// budget expressed in real capital + loss tolerances — "how much of the account may be at risk in
// total, per position, in event-driven names, and held overnight?".
//
// Those limits are the OPERATOR's actual risk numbers. We do NOT know them yet and MUST NOT invent
// them — a fabricated `capitalUsd` or a guessed `maxPortfolioLossPct` would silently size real risk
// on made-up assumptions. So the whole module ships ADVISORY-ONLY with all-null limits and
// `enforce:false`: it can be threaded through the allocator today (proving the wiring works and the
// output is unchanged), and the day the operator supplies real numbers + flips `enforce:true`, it
// starts returning HARD would-exceed verdicts with zero further code changes.
//
// TO ARM IT the operator must supply, per member (or per book tier): `capitalUsd` (the account size
// the percentages resolve against — WITHOUT it every percent limit is unconstrained, since a % of an
// unknown capital is an unknown dollar figure), plus whichever of `maxPortfolioLossPct` /
// `perPositionLossPct` / `eventExposureCap` / `overnightCap` they want live, and finally
// `enforce:true`. Any limit left null stays unconstrained even when enforcing.
//
// PURE & deterministic — no IO. Never throws, never blocks. `enforce:false` (or a null limit) means
// the verdict ANNOTATES ("wouldBreach") but the live path applies nothing.

/**
 * Whole-portfolio risk budget. Every `*Pct` is a percent of `capitalUsd` (the account size the
 * percentages resolve against). `null` on ANY field = that dimension is UNCONSTRAINED — never a
 * breach. No capital numbers are baked in on purpose; see the file header.
 */
export interface PortfolioBudget {
  /** Account size the percent limits resolve against. Null ⇒ every percent limit is unconstrained. */
  capitalUsd: number | null;
  /** Max total portfolio loss-at-risk, as % of capital. Null ⇒ unconstrained. */
  maxPortfolioLossPct: number | null;
  /** Max loss-at-risk for a SINGLE position, as % of capital. Null ⇒ unconstrained. */
  perPositionLossPct: number | null;
  /** Max loss-at-risk across EVENT-driven positions (earnings/catalyst), as % of capital. Null ⇒ unconstrained. */
  eventExposureCap: number | null;
  /** Max loss-at-risk across positions held OVERNIGHT, as % of capital. Null ⇒ unconstrained. */
  overnightCap: number | null;
  /** When false, the evaluator only annotates (advisory). When true, set+breached limits return HARD verdicts. */
  enforce: boolean;
}

/**
 * Advisory-only default: every limit null, `enforce:false`. With this, `evaluatePortfolioBudget`
 * NEVER reports a breach and the allocator behaves exactly as it does today. Kept DISARMED so every
 * pure test / advisory consumer that omits a budget stays a clean no-op. The LIVE commit path uses
 * `PRODUCTION_PORTFOLIO_BUDGET` (below), never this.
 */
export const DEFAULT_PORTFOLIO_BUDGET: PortfolioBudget = {
  capitalUsd: null,
  maxPortfolioLossPct: null,
  perPositionLossPct: null,
  eventExposureCap: null,
  overnightCap: null,
  enforce: false,
};

// ─── ARMED production budget (operator-delegated numbers — go-live 2026-07-24) ──────────────────────
// The operator delegated the risk numbers and authorized the swing lane LIVE. These are the HARD rails
// the live commit gate enforces against a $100k REFERENCE account (the engine's own model book — members
// size to their own capital at serve time; see swing-allocation.ts for the orthogonal %-of-member-book caps):
//   • capitalUsd 100_000        — the reference account the percentages resolve against.
//   • maxPortfolioLossPct 6     — TOTAL book heat: at most 6% ($6k) of loss-at-risk across every open swing.
//   • perPositionLossPct 2      — PER-TRADE risk: no single position risks more than 2% ($2k) max loss.
//   • eventExposureCap 3        — at most 3% ($3k) of loss-at-risk concentrated in EVENT-driven names.
//   • overnightCap 4            — at most 4% ($4k) of loss-at-risk held OVERNIGHT (every swing is overnight).
//   • enforce true              — ARMED: `hardExceeded` is populated and the commit gate BLOCKS on it.
// Reference constants (the fallback when no env override is set). Env-overridable via
// `resolveProductionPortfolioBudget()` so the operator can retune without a deploy.
export const PRODUCTION_PORTFOLIO_BUDGET: PortfolioBudget = {
  capitalUsd: 100_000,
  maxPortfolioLossPct: 6,
  perPositionLossPct: 2,
  eventExposureCap: 3,
  overnightCap: 4,
  enforce: true,
};

/** Parse a positive-finite number from an env string; null/blank/garbage → the fallback (never a NaN or 0). */
function envNum(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the LIVE portfolio budget: `PRODUCTION_PORTFOLIO_BUDGET` with each field overridable from the
 * environment, so the operator can retune the reference account / loss limits without a code deploy.
 *   SWING_CAPITAL_USD · SWING_MAX_PORTFOLIO_LOSS_PCT · SWING_PER_POSITION_LOSS_PCT ·
 *   SWING_EVENT_EXPOSURE_CAP · SWING_OVERNIGHT_CAP · SWING_BUDGET_ENFORCE (set to "0"/"false" to disarm).
 * A malformed/blank override falls back to the constant (never NaN/0 — a hollow limit could open the gate).
 * `enforce` stays TRUE unless explicitly disarmed, so the default posture is ARMED (fail-safe for real money).
 */
export function resolveProductionPortfolioBudget(
  env: Record<string, string | undefined> = process.env,
): PortfolioBudget {
  const enforceRaw = env.SWING_BUDGET_ENFORCE;
  const enforce =
    enforceRaw == null ? PRODUCTION_PORTFOLIO_BUDGET.enforce : !/^(0|false|no|off)$/i.test(enforceRaw.trim());
  return {
    capitalUsd: envNum(env.SWING_CAPITAL_USD, PRODUCTION_PORTFOLIO_BUDGET.capitalUsd!),
    maxPortfolioLossPct: envNum(env.SWING_MAX_PORTFOLIO_LOSS_PCT, PRODUCTION_PORTFOLIO_BUDGET.maxPortfolioLossPct!),
    perPositionLossPct: envNum(env.SWING_PER_POSITION_LOSS_PCT, PRODUCTION_PORTFOLIO_BUDGET.perPositionLossPct!),
    eventExposureCap: envNum(env.SWING_EVENT_EXPOSURE_CAP, PRODUCTION_PORTFOLIO_BUDGET.eventExposureCap!),
    overnightCap: envNum(env.SWING_OVERNIGHT_CAP, PRODUCTION_PORTFOLIO_BUDGET.overnightCap!),
    enforce,
  };
}

/** One position's contribution to the portfolio risk budget. `riskUsd` = its max loss (dollar risk). */
export interface BudgetPosition {
  ticker: string;
  /** Dollar loss-at-risk of this position (max loss). Null/undefined ⇒ contributes 0 to every dimension. */
  riskUsd?: number | null;
  /** Event-driven exposure (earnings/catalyst) — counts against `eventExposureCap`. */
  isEvent?: boolean;
  /** Held overnight — counts against `overnightCap`. */
  isOvernight?: boolean;
}

export type BudgetDimension = "portfolio_loss" | "per_position_loss" | "event_exposure" | "overnight";

export interface BudgetDimensionVerdict {
  dimension: BudgetDimension;
  /** True only when the limit is set AND capital is known — otherwise the dimension is unconstrained. */
  constrained: boolean;
  /** Resolved dollar limit (pct × capital), or null when unconstrained. */
  limitUsd: number | null;
  /** Observed dollar loss-at-risk for this dimension. */
  observedUsd: number;
  /** ADVISORY: would the observed exceed the limit? Always false when unconstrained. */
  wouldBreach: boolean;
  /** Tickers responsible (per-position dimension only lists the offenders). */
  offenders: string[];
}

export interface PortfolioBudgetVerdict {
  /** Mirrors the budget's flag so a consumer can tell advisory-only from armed at a glance. */
  enforce: boolean;
  verdicts: BudgetDimensionVerdict[];
  /** Dimensions that WOULD breach (advisory) — populated regardless of `enforce`. */
  advisoryBreaches: BudgetDimension[];
  /**
   * Dimensions that are HARD over-limit — ONLY populated when `enforce:true` AND the limit is set.
   * Empty when advisory-only. Nothing in the live path consults this yet.
   */
  hardExceeded: BudgetDimension[];
}

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const risk = (p: BudgetPosition): number => (isFin(p.riskUsd) && p.riskUsd > 0 ? p.riskUsd : 0);

/**
 * Resolve one dimension's verdict. A dimension is CONSTRAINED only when its percent limit is set AND
 * `capitalUsd` is known (a percent of unknown capital is an unknown dollar figure ⇒ unconstrained).
 * `offenders` lists the contributing tickers so a caller can explain the flag.
 */
function evalDimension(
  dimension: BudgetDimension,
  limitPct: number | null,
  capitalUsd: number | null,
  contributors: BudgetPosition[],
  /** per-position compares EACH position to the limit; aggregate compares the SUM. */
  mode: "aggregate" | "per_position",
): BudgetDimensionVerdict {
  const constrained = isFin(limitPct) && limitPct > 0 && isFin(capitalUsd) && capitalUsd > 0;
  const limitUsd = constrained ? (limitPct * capitalUsd) / 100 : null;

  if (mode === "per_position") {
    // The observed for the per-position dimension is the LARGEST single position (the binding one).
    let maxRisk = 0;
    const offenders: string[] = [];
    for (const p of contributors) {
      const r = risk(p);
      if (r > maxRisk) maxRisk = r;
      if (constrained && limitUsd != null && r > limitUsd) offenders.push(p.ticker.trim().toUpperCase());
    }
    return {
      dimension,
      constrained,
      limitUsd,
      observedUsd: maxRisk,
      wouldBreach: constrained && limitUsd != null && offenders.length > 0,
      offenders,
    };
  }

  const observedUsd = contributors.reduce((sum, p) => sum + risk(p), 0);
  const wouldBreach = constrained && limitUsd != null && observedUsd > limitUsd;
  return {
    dimension,
    constrained,
    limitUsd,
    observedUsd,
    wouldBreach,
    // Aggregate offenders = every contributor with nonzero risk (they collectively cause the breach).
    offenders: wouldBreach ? contributors.filter((p) => risk(p) > 0).map((p) => p.ticker.trim().toUpperCase()) : [],
  };
}

/**
 * Evaluate a set of positions against a portfolio budget. PURE — never throws, never mutates, never
 * blocks. Returns advisory `wouldBreach` flags per dimension always; `hardExceeded` is populated
 * ONLY when `budget.enforce` is true AND the offending limit is actually set. A null limit or null
 * capital leaves that dimension unconstrained (no breach). With `DEFAULT_PORTFOLIO_BUDGET` the result
 * is a clean no-op: every dimension unconstrained, no advisory breaches, `hardExceeded` empty.
 */
export function evaluatePortfolioBudget(
  positions: BudgetPosition[],
  budget: PortfolioBudget = DEFAULT_PORTFOLIO_BUDGET,
): PortfolioBudgetVerdict {
  const cap = budget.capitalUsd;
  const verdicts: BudgetDimensionVerdict[] = [
    evalDimension("portfolio_loss", budget.maxPortfolioLossPct, cap, positions, "aggregate"),
    evalDimension("per_position_loss", budget.perPositionLossPct, cap, positions, "per_position"),
    evalDimension("event_exposure", budget.eventExposureCap, cap, positions.filter((p) => p.isEvent), "aggregate"),
    evalDimension("overnight", budget.overnightCap, cap, positions.filter((p) => p.isOvernight), "aggregate"),
  ];

  const advisoryBreaches = verdicts.filter((v) => v.wouldBreach).map((v) => v.dimension);
  // HARD verdicts require the budget to be armed. Advisory-only (enforce:false) ⇒ always empty.
  const hardExceeded = budget.enforce ? advisoryBreaches.slice() : [];

  return { enforce: budget.enforce, verdicts, advisoryBreaches, hardExceeded };
}

/** Dollar loss-at-risk a candidate contributes (its max loss). Null/≤0 ⇒ 0 — unknown risk never blocks. */
export function budgetRiskUsd(p: BudgetPosition): number {
  return risk(p);
}

/** The verdict of the HARD pre-commit budget gate for ONE candidate against the current live book. */
export interface SwingCommitBudgetVerdict {
  /** True when the candidate MUST be blocked — it is part of a HARD-exceeded dimension it contributes to. */
  blocked: boolean;
  /** The hard-exceeded dimensions the candidate contributes to (the block reasons). Empty ⇒ cleared. */
  blockedDimensions: BudgetDimension[];
  /** The candidate's own loss-at-risk (0 when unknown). */
  candidateRiskUsd: number;
  /** Mirrors the budget's flag — advisory (enforce:false) NEVER blocks. */
  enforce: boolean;
  /** The full verdict over (book + candidate) — surfaced verbatim as the queryable reason. */
  verdict: PortfolioBudgetVerdict;
}

/**
 * HARD pre-commit budget gate: would opening `candidate` on top of the CURRENT live `book` push a budget
 * dimension the candidate CONTRIBUTES to into HARD over-limit? This is the money guard the live commit path
 * consults (unlike `evaluatePortfolioBudget`, which only annotates the whole set).
 *
 * A candidate is blocked ONLY for a hard-exceeded dimension it actually contributes to — never for one it
 * doesn't touch (a non-event candidate is never blocked by an event-exposure breach; a small candidate is
 * never blocked by an EXISTING position's per-position breach). This encodes the operator's edge cases:
 *   • unknown/zero risk ⇒ 0 contribution ⇒ never blocked on the budget (don't block on unknown);
 *   • a single position over `perPositionLossPct` ⇒ it is its own per-position offender ⇒ blocked;
 *   • the book already at an aggregate cap ⇒ any nonzero-risk candidate contributing to that dimension is
 *     blocked until a close frees room.
 * Advisory (enforce:false) ⇒ `blocked:false` always (mirrors `hardExceeded` being empty when disarmed).
 */
export function evaluateSwingCommitBudget(
  book: BudgetPosition[],
  candidate: BudgetPosition,
  budget: PortfolioBudget = DEFAULT_PORTFOLIO_BUDGET,
): SwingCommitBudgetVerdict {
  const verdict = evaluatePortfolioBudget([...book, candidate], budget);
  const candidateRiskUsd = risk(candidate);
  const base: Omit<SwingCommitBudgetVerdict, "blocked" | "blockedDimensions"> = {
    candidateRiskUsd,
    enforce: budget.enforce,
    verdict,
  };
  // Disarmed, or nothing hard-exceeded → the gate is open.
  if (!budget.enforce || verdict.hardExceeded.length === 0) {
    return { ...base, blocked: false, blockedDimensions: [] };
  }
  const key = candidate.ticker.trim().toUpperCase();
  const blockedDimensions = verdict.hardExceeded.filter((dim) => {
    const dv = verdict.verdicts.find((v) => v.dimension === dim);
    switch (dim) {
      case "per_position_loss":
        // Per-position lists exactly the positions whose OWN risk exceeds the cap — block iff the candidate
        // is itself an offender (an existing over-cap position must not block a fresh small one).
        return dv?.offenders.includes(key) ?? false;
      case "event_exposure":
        return candidate.isEvent === true && candidateRiskUsd > 0;
      case "overnight":
        return candidate.isOvernight === true && candidateRiskUsd > 0;
      case "portfolio_loss":
      default:
        return candidateRiskUsd > 0;
    }
  });
  return { ...base, blocked: blockedDimensions.length > 0, blockedDimensions };
}

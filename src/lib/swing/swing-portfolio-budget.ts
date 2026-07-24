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
 * NEVER reports a breach and the allocator behaves exactly as it does today. Arming it is a
 * deferred operator input (real `capitalUsd` + loss limits + `enforce:true`).
 */
export const DEFAULT_PORTFOLIO_BUDGET: PortfolioBudget = {
  capitalUsd: null,
  maxPortfolioLossPct: null,
  perPositionLossPct: null,
  eventExposureCap: null,
  overnightCap: null,
  enforce: false,
};

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

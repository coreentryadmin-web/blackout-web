// src/lib/swing/swing-allocation.ts — advisory risk-budgeted allocation for the swing book (PR-6).
//
// The gate answers "is THIS swing good?"; this answers the PORTFOLIO question the gate can't: given everything
// that cleared, where should scarce book weight go, and is the book over-concentrated in one thesis / one
// expiry week? It reuses `allocate()` (portfolio/allocation) as the ranking + best-first WALK skeleton, then
// applies the swing-specific caps on top.
//
// THE CAPS ARE % OF THE MEMBER'S OWN BOOK — deliberately NOT a global dollar figure. A swing engine serves many
// members with different account sizes; the only portable budget is a fraction of each member's own capital, and
// the actual $ is resolved per-user at serve time from their account size. So every cap here is a percent:
//   • per-position         5%   — no single swing is more than 5% of the member's book.
//   • per-theme-sector    20%   — all positions in ONE thesis AGGREGATE against this (clusterPolicy AGGREGATE_CAP).
//   • total-in-swings     40%   — the whole swing sleeve is at most 40% of the book (the rest is 0DTE / cash / core).
//   • max-same-week-expiry 3    — at most 3 positions expiring the same calendar week (a single-week gap-risk cluster).
// (Operator-confirmed defaults.)
//
// AGGREGATE_CAP: theme concentration is measured by SUMMING every same-theme position's weight, NOT by counting
// names — NVDA + AMD + SMH + QQQ collapse (via the ONE theme resolver, theme-cluster.ts) to a single "semis"
// theme and their 5%+5%+5%+5% aggregates to 20% against the one 20% cap. That's why a ticker-count cap (like
// allocation.ts's maxPerSector) is the wrong tool and this module walks a running %-aggregate instead.
//
// ENFORCE:FALSE — advisory ONLY. This ANNOTATES each decision with which caps it would breach; it RESIZES and
// BLOCKS NOTHING. `proposedPct` stays the nominal per-position weight on every decision regardless of the flags,
// and every candidate stays in the output. The caps only start sizing/blocking real risk once the portfolio
// backtest graduates them (PR-16). `advisorySizing` is a SUGGESTION for that future, never an applied action.
//
// PURE & deterministic — no IO. Themes resolved through theme-cluster.ts (the same partition the gate flags).

import type { PlayDirection } from "../horizon-fanout";
import { allocate, type AllocationCandidate } from "../portfolio/allocation";
import { resolveTheme } from "./theme-cluster";
import {
  evaluatePortfolioBudget,
  DEFAULT_PORTFOLIO_BUDGET,
  type PortfolioBudget,
  type PortfolioBudgetVerdict,
  type BudgetPosition,
} from "./swing-portfolio-budget";

export interface SwingCaps {
  /** Max % of the member's book in a single swing position. */
  perPositionPct: number;
  /** Max % of the member's book AGGREGATED across all positions in one theme/sector. */
  perThemeSectorPct: number;
  /** Max % of the member's book across the WHOLE swing sleeve. */
  totalInSwingsPct: number;
  /** Max positions expiring in the same calendar week. */
  maxSameWeekExpiry: number;
  /** Rank-percentile at/below which a survivor is advisory-HALF (weaker end of the book). Mirrors allocate(). */
  halfSizeBelowPct: number;
}

/** Operator-confirmed v1 caps. All % are of the MEMBER's own book (no global $). */
export const DEFAULT_SWING_CAPS: SwingCaps = {
  perPositionPct: 5,
  perThemeSectorPct: 20,
  totalInSwingsPct: 40,
  maxSameWeekExpiry: 3,
  halfSizeBelowPct: 0.34,
};

/** A theme's positions AGGREGATE against the theme cap (not counted) — the SEV-9 collapse the caps depend on. */
export const CLUSTER_POLICY = "AGGREGATE_CAP" as const;
export type ClusterPolicy = typeof CLUSTER_POLICY;

export interface SwingAllocationCandidate {
  ticker: string;
  direction: PlayDirection;
  /** 0–100 committed evidence score (ranks when `ev` is absent). */
  score: number;
  /** Calibrated EV in R when the store can price it; ranks over score when finite. Null today. */
  ev?: number | null;
  /** Option expiry `YYYY-MM-DD` — feeds the same-week-expiry cluster cap. Null ⇒ no week bucket. */
  expiry?: string | null;
}

/** A held swing position — seeds the running theme / book / same-week aggregates. */
export interface ExistingSwingPosition {
  ticker: string;
  direction: PlayDirection;
  expiry?: string | null;
  /** Current weight as % of the member's book; defaults to the per-position cap when unknown. */
  weightPct?: number | null;
}

export type SwingCapCode = "per_position" | "per_theme_sector" | "total_in_swings" | "max_same_week_expiry";

export interface SwingCapFlag {
  cap: SwingCapCode;
  /** True when INCLUDING this position would breach the cap. Advisory (enforce:false) — nothing is applied. */
  wouldBreach: boolean;
  /** The cap limit (% of book, or a count for the expiry cap). */
  limit: number;
  /** The observed value AFTER including this position (running theme/book % or same-week count). */
  observed: number;
  basis: "pct_member_book" | "count";
}

export type SwingAdvisorySizing = "FULL" | "HALF" | "SKIP";

export interface SwingAllocationDecision {
  ticker: string;
  direction: PlayDirection;
  /** Resolved theme cluster (the AGGREGATE_CAP partition). */
  theme: string;
  /** The value ranked on (ev when finite, else score). */
  rankValue: number;
  /** 1 = best opportunity today. */
  rank: number;
  /** 0–1 (1 = top of the set). */
  percentile: number;
  /** Nominal weight this position requests — ALWAYS the per-position cap; never resized (enforce:false). */
  proposedPct: number;
  /** Running theme aggregate % AFTER this position (AGGREGATE_CAP). */
  themeAggregatePct: number;
  /** Running total-in-swings % AFTER this position. */
  bookAggregatePct: number;
  /** Monday-anchored week key of the expiry, or null. */
  expiryWeek: string | null;
  /** Advisory cap flags — which caps this position WOULD breach. enforce:false ⇒ not applied. */
  capFlags: SwingCapFlag[];
  /** What sizing the caps WOULD suggest (SKIP on any breach) — a suggestion only, never applied. */
  advisorySizing: SwingAdvisorySizing;
  reasons: string[];
}

export interface SwingCapsApplied {
  /** Themes whose aggregate exceeded the theme cap (the over-concentrated theses). */
  themesOverCap: string[];
  /** True when the whole swing sleeve exceeded the total-in-swings cap. */
  totalInSwingsOverCap: boolean;
  /** Expiry weeks that exceeded the same-week cap. */
  weeksOverCap: string[];
  /** Tickers whose proposed weight exceeded the per-position cap (only possible via injected existing weights). */
  positionsOverCap: string[];
  clusterPolicy: ClusterPolicy;
}

export interface SwingAllocationResult {
  decisions: SwingAllocationDecision[];
  capsApplied: SwingCapsApplied;
  /** ADVISORY ONLY — the caps annotate; they resize/block nothing until PR-16 graduates them. */
  enforce: false;
  /**
   * ADVISORY portfolio-budget verdict (whole-book capital/loss dimension, orthogonal to the % caps
   * above). With `DEFAULT_PORTFOLIO_BUDGET` (all-null limits, enforce:false) this is a clean no-op —
   * every dimension unconstrained, no breaches — and `decisions`/`capsApplied` are IDENTICAL to a run
   * without a budget. It arms only when the operator supplies real capital + loss limits + enforce:true;
   * even then nothing in the live path consults it yet. See swing-portfolio-budget.ts.
   */
  portfolioBudget: PortfolioBudgetVerdict;
}

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Monday-anchored (UTC) week key `YYYY-MM-DD` for an expiry date — two expiries in one Mon–Sun week share it. */
export function expiryWeekKey(expiry: string | null | undefined): string | null {
  if (!expiry) return null;
  const d = new Date(`${expiry}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  return mon.toISOString().slice(0, 10);
}

/**
 * Allocate the swing book advisory-only. Ranks via `allocate()`, then walks best-first accumulating the running
 * theme %, total book %, and same-week expiry counts (seeded from `existing`), flagging every cap a position
 * WOULD breach. Nothing is resized: `proposedPct` is the per-position cap on every decision, all candidates
 * survive to the output, and `enforce` is `false`. `existing` is injectable ([] is valid — a four-name cluster
 * inside one candidate set still aggregates against the theme cap on its own).
 */
export function allocateSwingBook(
  candidates: SwingAllocationCandidate[],
  existing: ExistingSwingPosition[] = [],
  caps: SwingCaps = DEFAULT_SWING_CAPS,
  // Whole-portfolio capital/loss budget — advisory. Defaulting to DEFAULT_PORTFOLIO_BUDGET (all-null,
  // enforce:false) makes the budget a strict no-op: it is CONSULTED but changes NOTHING about the
  // decisions/capsApplied below. See swing-portfolio-budget.ts for why it ships disarmed.
  budget: PortfolioBudget = DEFAULT_PORTFOLIO_BUDGET,
): SwingAllocationResult {
  // Reuse allocate() purely for the deterministic rank/percentile/rankValue skeleton (theme as its sector).
  const allocInput: AllocationCandidate[] = candidates.map((c) => ({
    ticker: c.ticker,
    direction: c.direction,
    score: c.score,
    ev: c.ev ?? null,
    sector: resolveTheme(c.ticker),
  }));
  const ranked = allocate(allocInput); // ranked order; we apply OUR % caps, not allocate()'s count caps.

  // Index candidates by uppercased ticker so we can recover expiry per ranked decision.
  const byTicker = new Map<string, SwingAllocationCandidate>();
  for (const c of candidates) byTicker.set(c.ticker.trim().toUpperCase(), c);

  // Seed the running aggregates from existing exposure — a thesis the book already holds counts against its cap.
  const themePct = new Map<string, number>();
  const weekCount = new Map<string, number>();
  let bookPct = 0;
  for (const e of existing) {
    const theme = resolveTheme(e.ticker);
    const w = isFin(e.weightPct) ? e.weightPct : caps.perPositionPct;
    themePct.set(theme, (themePct.get(theme) ?? 0) + w);
    bookPct += w;
    const wk = expiryWeekKey(e.expiry);
    if (wk) weekCount.set(wk, (weekCount.get(wk) ?? 0) + 1);
  }

  const themesOverCap = new Set<string>();
  const weeksOverCap = new Set<string>();
  const positionsOverCap: string[] = [];
  let totalInSwingsOverCap = false;

  const decisions: SwingAllocationDecision[] = ranked.map((d) => {
    const cand = byTicker.get(d.ticker.toUpperCase());
    const theme = resolveTheme(d.ticker);
    const week = expiryWeekKey(cand?.expiry ?? null);
    const proposedPct = caps.perPositionPct; // never resized — enforce:false

    // AGGREGATE_CAP: SUM this position's weight into its theme + the book; increment the same-week count.
    const themeAfter = (themePct.get(theme) ?? 0) + proposedPct;
    const bookAfter = bookPct + proposedPct;
    const weekAfter = week ? (weekCount.get(week) ?? 0) + 1 : 0;
    themePct.set(theme, themeAfter);
    bookPct = bookAfter;
    if (week) weekCount.set(week, weekAfter);

    const capFlags: SwingCapFlag[] = [
      {
        cap: "per_position",
        wouldBreach: proposedPct > caps.perPositionPct,
        limit: caps.perPositionPct,
        observed: round2(proposedPct),
        basis: "pct_member_book",
      },
      {
        cap: "per_theme_sector",
        wouldBreach: themeAfter > caps.perThemeSectorPct,
        limit: caps.perThemeSectorPct,
        observed: round2(themeAfter),
        basis: "pct_member_book",
      },
      {
        cap: "total_in_swings",
        wouldBreach: bookAfter > caps.totalInSwingsPct,
        limit: caps.totalInSwingsPct,
        observed: round2(bookAfter),
        basis: "pct_member_book",
      },
      {
        cap: "max_same_week_expiry",
        wouldBreach: week != null && weekAfter > caps.maxSameWeekExpiry,
        limit: caps.maxSameWeekExpiry,
        observed: weekAfter,
        basis: "count",
      },
    ];

    const breached = capFlags.filter((f) => f.wouldBreach);
    for (const f of breached) {
      if (f.cap === "per_theme_sector") themesOverCap.add(theme);
      if (f.cap === "total_in_swings") totalInSwingsOverCap = true;
      if (f.cap === "max_same_week_expiry" && week) weeksOverCap.add(week);
      if (f.cap === "per_position") positionsOverCap.push(d.ticker.toUpperCase());
    }

    // Advisory sizing only (never applied): SKIP if any cap would breach, else HALF at the weak end, else FULL.
    let advisorySizing: SwingAdvisorySizing;
    const reasons: string[] = [];
    if (breached.length > 0) {
      advisorySizing = "SKIP";
      reasons.push(`would breach ${breached.map((f) => f.cap).join(", ")} (advisory — enforce:false, not applied)`);
    } else if (d.percentile <= caps.halfSizeBelowPct) {
      advisorySizing = "HALF";
      reasons.push("weaker end of today's swing set — advisory half size");
    } else {
      advisorySizing = "FULL";
      reasons.push(`rank #${d.rank} · primary theme "${theme}"`);
    }

    return {
      ticker: d.ticker.toUpperCase(),
      direction: d.direction,
      theme,
      rankValue: d.rankValue,
      rank: d.rank,
      percentile: d.percentile,
      proposedPct,
      themeAggregatePct: round2(themeAfter),
      bookAggregatePct: round2(bookAfter),
      expiryWeek: week,
      capFlags,
      advisorySizing,
      reasons,
    };
  });

  // Consult the whole-portfolio budget over the same set (existing holds + this session's decisions).
  // We pass ONLY tickers — no invented riskUsd/isEvent/isOvernight — so with the default (all-null)
  // budget every dimension is unconstrained and this is provably a no-op on the allocation above. The
  // operator arms it later by supplying real per-position risk on ExistingSwingPosition + real limits.
  const budgetPositions: BudgetPosition[] = [
    ...existing.map((e) => ({ ticker: e.ticker })),
    ...decisions.map((d) => ({ ticker: d.ticker })),
  ];
  const portfolioBudget = evaluatePortfolioBudget(budgetPositions, budget);

  return {
    decisions,
    capsApplied: {
      themesOverCap: [...themesOverCap],
      totalInSwingsOverCap,
      weeksOverCap: [...weeksOverCap],
      positionsOverCap,
      clusterPolicy: CLUSTER_POLICY,
    },
    enforce: false,
    portfolioBudget,
  };
}

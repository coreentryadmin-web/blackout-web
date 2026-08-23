/**
 * COMMAND DECK — cockpit header math (pure, display-only).
 *
 * The left-panel cockpit strip (Wave 2) shows two live, auto-updating figures off the SWR board
 * refresh:
 *  1. PORTFOLIO RISK — total R deployed vs the allocator's sanctioned limit, read from the payload
 *     `allocation` (the Portfolio Allocation Engine's per-name FULL/HALF/SKIP decisions). "Deployed"
 *     is the risk actually ON (a sanctioned name that is a WORKING position on the board); the "limit"
 *     is the full book the allocator greenlit today at their sized weights.
 *  2. SESSION P&L TAPE — realized (CLOSED rows) + open (working rows) across the board's ledger, in R
 *     units. A 0DTE play risks its premium to the −50% ratchet stop = 1R, so P&L in R = pnl% / 50
 *     (a −50% stop is −1R, a +100% double is +2R). This makes a running tape comparable across plays
 *     of different premiums, unlike summing raw percentages.
 *
 * PURE — no React, no IO — so the whole strip is unit-tested against fixtures. Every figure degrades
 * to null when its inputs aren't on the payload (the strip renders "—", never a fabricated number).
 */

import type { DeckStatus, TerminalPlay } from "./types";

/** A minimal shape of one allocator decision the cockpit reads (a subset of AllocationDecision —
 *  allocation.ts). Kept structural (sizing typed as a plain string) so a raw JSON payload row parses
 *  without importing the engine's Sizing union or casting — an unrecognized sizing weighs 0. */
export interface CockpitAllocation {
  ticker: string;
  sizing: string;
}

/** The −50% ratchet stop is the 1R risk unit (PLAN_RULES.stop_pct = −50). A play's P&L in R is its
 *  premium return divided by this: −50% = −1R, +100% = +2R. Local constant (not an import) so this
 *  horizon-agnostic deck module stays free of the 0DTE plan graph; kept in sync by this comment. */
export const R_STOP_ABS_PCT = 50;

/** R-weight of one allocator sizing decision: FULL = 1R, HALF = 0.5R, anything else (SKIP/unknown) = 0
 *  (not deployed). Case-insensitive so a raw payload string still resolves. */
export function sizingWeight(sizing: string): number {
  const s = sizing?.toUpperCase();
  return s === "FULL" ? 1 : s === "HALF" ? 0.5 : 0;
}

/** Working (member-held) statuses — the positions whose risk is actually ON. Mirrors WORKING_STATUSES
 *  in zerodte-sources.ts, restated here so the pure math has no cross-module coupling. */
const WORKING: ReadonlySet<DeckStatus> = new Set<DeckStatus>(["OPEN", "HOLD", "TRIM"]);

export interface DeployedRisk {
  /** R actually deployed — sanctioned names that are WORKING positions on the board, at sized weight. */
  deployedR: number;
  /** R the allocator sanctioned today — every non-SKIP decision at its sized weight (the limit). */
  limitR: number;
}

/**
 * Total R deployed vs the allocator limit, from the payload allocation + the set of working tickers on
 * the board. Returns null when the allocation is empty/absent (the allocator couldn't rank the book
 * this build) so the strip shows "—" rather than a misleading "0 / 0 R". `deployedR` counts only a
 * sanctioned name that is CURRENTLY a working position (risk on); `limitR` is the whole sanctioned
 * book. Case-insensitive ticker match. Pure.
 */
export function deployedRisk(
  allocation: readonly CockpitAllocation[] | null | undefined,
  workingTickers: ReadonlySet<string>,
): DeployedRisk | null {
  if (!allocation || allocation.length === 0) return null;
  const working = new Set([...workingTickers].map((t) => t.toUpperCase()));
  let deployedR = 0;
  let limitR = 0;
  for (const a of allocation) {
    const w = sizingWeight(a.sizing);
    if (w === 0) continue; // SKIP — not part of the sanctioned book
    limitR += w;
    if (working.has(String(a.ticker ?? "").toUpperCase())) deployedR += w;
  }
  return { deployedR: round1(deployedR), limitR: round1(limitR) };
}

export interface SessionTape {
  /** Realized R across CLOSED rows (pnl% / 50). */
  realizedR: number;
  /** Open (mark-to-market) R across WORKING rows. */
  openR: number;
  /** realizedR + openR — the running session tape. */
  totalR: number;
  /** Count of CLOSED rows that contributed a realized figure. */
  realizedCount: number;
  /** Count of WORKING rows that contributed an open figure. */
  openCount: number;
  /** True when NO row carried a P&L to tape (the whole session is pre-entry) — render "—". */
  empty: boolean;
  /** Horizons that contributed to this tape (so we can label when R is mixed/derived). */
  horizons: Set<TerminalPlay["horizon"]>;
  /** True when the tape includes SWING or other non-0DTE plays — the R-unit is 0DTE-derived
   *  proxy, not native to swings' thesis-primary exit model. Members should understand the
   *  −50% stop is a reference, not the actual swing thesis break that drove a position's exit. */
  hasProxyR: boolean;
}

/**
 * The running session P&L tape in R units, split realized (CLOSED) vs open (working), across the
 * board's plays. A play with no P&L (a WATCH/SKIP pre-entry row, or a working row with no mark yet) is
 * skipped — never counted as 0, so an un-priced book reads honestly as `empty`, not "flat". Pure over
 * TerminalPlay[] so it composes with the same list the deck renders.
 *
 * R-UNIT NOTE: the −50% stop (R_STOP_ABS_PCT) is 0DTE's native 1R unit. For SWING plays, this is a
 * derived proxy — swings use thesis-primary exits (structural breaks), not premium stops. The tape
 * still uses 50% for consistency and comparability, but hasProxyR flags when the board includes
 * plays whose actual risk model differs, so a label can be rendered (members should understand the
 * −50% is a reference, not the break that actually closed a swing position).
 */
export function sessionTape(plays: readonly TerminalPlay[]): SessionTape {
  let realizedR = 0;
  let openR = 0;
  let realizedCount = 0;
  let openCount = 0;
  const horizons = new Set<TerminalPlay["horizon"]>();
  for (const p of plays) {
    horizons.add(p.horizon);
    if (p.pnlPct == null) continue; // no P&L to tape — pre-entry / un-priced
    const r = p.pnlPct / R_STOP_ABS_PCT;
    if (p.status === "CLOSED") {
      realizedR += r;
      realizedCount += 1;
    } else if (WORKING.has(p.status)) {
      openR += r;
      openCount += 1;
    }
    // WATCH / SKIP are not entered — excluded even if a would-be mark exists.
  }
  const hasProxyR = horizons.has("SWING") || horizons.has("LEAPS") || horizons.has("LEGACY");
  return {
    realizedR: round1(realizedR),
    openR: round1(openR),
    totalR: round1(realizedR + openR),
    realizedCount,
    openCount,
    empty: realizedCount === 0 && openCount === 0,
    horizons,
    hasProxyR,
  };
}

/** The set of WORKING (OPEN/HOLD/TRIM) tickers on the board — the deployedRisk() input. */
export function workingTickersOf(plays: readonly TerminalPlay[]): Set<string> {
  const out = new Set<string>();
  for (const p of plays) if (WORKING.has(p.status)) out.add(p.ticker.toUpperCase());
  return out;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

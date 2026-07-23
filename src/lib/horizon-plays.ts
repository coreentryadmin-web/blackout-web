/**
 * Night Hawk — per-horizon play producer (remodel slice 3b).
 *
 * The brain that turns "8,000 tickers" into "here are the 0DTE, Swing, and LEAPS plays." It sits on top
 * of the two earlier slices:
 *   - horizons.ts       — the 3-lane spec (DTE windows, score floors, exit routing)
 *   - horizon-fanout.ts — one chain → best liquid contract per lane
 *
 * Given a pool of scored whole-market candidates (each with a direction + its full option chain), this
 * fans every candidate across the three windows and emits one structured play per (candidate × lane) that
 * actually has a tradeable contract. Each play is stamped COMMIT (score ≥ the lane's floor) or WATCH
 * (has a real contract but under the floor) — the same "shown but not committed" distinction the desk
 * already uses, now uniform across all three horizons. Lanes come back sorted by score, highest first.
 *
 * Pure and deterministic — no IO. Discovery (the whole-market scan) feeds it candidates; a live route or
 * the sim calls it; the grader/ledger consume its output. Unit-testable with synthetic candidates.
 */

import { HORIZON_ORDER, HORIZONS, type Horizon } from "./horizons";
import {
  fanOutChain,
  DEFAULT_LIQUIDITY,
  type ChainContract,
  type LiquidityGate,
  type PlayDirection,
  explodeChainRows,
} from "./horizon-fanout";

/** A scored whole-market candidate from discovery, with its full option chain attached. */
export interface HorizonCandidate {
  ticker: string;
  /** LONG buys calls, SHORT buys puts. */
  direction: PlayDirection;
  /** 0–100 conviction score from the discovery/scoring layer. */
  score: number;
  /** As-of date (YYYY-MM-DD) the DTEs are measured from. */
  asOfYmd: string;
  /** The name's full option chain (every listed expiry × strike). */
  chainRows: Parameters<typeof explodeChainRows>[1];
}

/** Whether a play is committed (over the lane's floor) or watch-only (real contract, under floor). */
export type PlayStatus = "COMMIT" | "WATCH";

/** One produced play: a candidate expressed at one horizon with a concrete, liquid contract. */
export interface HorizonPlay {
  ticker: string;
  direction: PlayDirection;
  horizon: Horizon;
  score: number;
  status: PlayStatus;
  contract: ChainContract;
  /** The lane's commit floor, and whether this score cleared it (for UI/debug transparency). */
  scoreFloor: number;
  /** Human summary of the chosen contract. */
  reason: string;
}

/** The three lanes a candidate pool fans out into. */
export type HorizonPlaySet = Record<Horizon, HorizonPlay[]>;

/** An empty play set (all three lanes present, per the spine's always-three invariant). */
function emptyPlaySet(): HorizonPlaySet {
  return { ZERO_DTE: [], SWING: [], LEAPS: [] };
}

/**
 * Fan a pool of scored candidates across all three horizons. Every (candidate × lane) that has a
 * tradeable contract becomes one play, stamped COMMIT/WATCH against the lane's floor. Each lane is
 * returned sorted by score (desc), then by delta-fit tie-break already applied inside the fan-out.
 */
export function produceHorizonPlays(
  candidates: HorizonCandidate[],
  gate: LiquidityGate = DEFAULT_LIQUIDITY,
): HorizonPlaySet {
  const out = emptyPlaySet();

  for (const cand of candidates) {
    if (!cand.ticker || !Number.isFinite(cand.score)) continue;
    const picks = fanOutChain(cand.ticker, cand.chainRows, cand.asOfYmd, cand.direction, gate);
    for (const pick of picks) {
      if (!pick.contract) continue; // no liquid contract at this horizon → this name simply isn't in this lane
      const spec = HORIZONS[pick.horizon];
      out[pick.horizon].push({
        ticker: cand.ticker.toUpperCase(),
        direction: cand.direction,
        horizon: pick.horizon,
        score: cand.score,
        status: cand.score >= spec.scoreFloor ? "COMMIT" : "WATCH",
        contract: pick.contract,
        scoreFloor: spec.scoreFloor,
        reason: pick.reason,
      });
    }
  }

  for (const h of HORIZON_ORDER) {
    out[h].sort((a, b) => b.score - a.score);
  }
  return out;
}

/** The committed plays only (score ≥ floor) for a lane — what the desk surfaces as a live play. */
export function committedPlays(set: HorizonPlaySet, horizon: Horizon): HorizonPlay[] {
  return set[horizon].filter((p) => p.status === "COMMIT");
}

/** The watch-only plays (real contract, under floor) for a lane — the "skipped & watching" rail. */
export function watchPlays(set: HorizonPlaySet, horizon: Horizon): HorizonPlay[] {
  return set[horizon].filter((p) => p.status === "WATCH");
}

/** Flat count of committed plays across all three lanes. */
export function totalCommitted(set: HorizonPlaySet): number {
  return HORIZON_ORDER.reduce((n, h) => n + committedPlays(set, h).length, 0);
}

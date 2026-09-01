/**
 * Suggested plays for earnings — call/put pair generated from GEX walls + positioning.
 * One pair per event: the strike setup that captures post-earnings regime in both directions.
 *
 * Strike selection: the wall nearest post-move is the directional threshold; the cross-wall
 * is the hedge. Markets price call walls higher (ask) than put walls (bid) by definition, so
 * a call-heavy regime (gamma flip, dealer short gamma) names PUT as the primary thesis and
 * CALL as the hedge. A put-heavy regime is the inverse.
 *
 * Data sources: GEX thermal (walls, king, max pain), expected move, post-print lean.
 * Omitted: detailed calibration pending Coordinator approval of design questions.
 */

import type { MeridianEarningsThermalRead } from "@/features/meridian/lib/meridian-types";

export type SuggestedPlay = {
  /** The strike offering the primary directional exposure (where regime bets it goes). */
  primary_strike: number;
  /** Call or Put. */
  primary_side: "C" | "P";
  /** The strike offering the hedge (cross-wall, directional insurance). */
  hedge_strike: number;
  hedge_side: "C" | "P";
  /** Derived from GEX walls: the raw ratio of call wall to put wall at these strikes. */
  positioning_pct: number;
  /** Coverage: the expiry date as YYYY-MM-DD that spans from event to follow-through. */
  expiry: string;
  /** Rationale: "GEX walls favor puts" | "GEX walls favor calls" | "Walls balanced". */
  thesis: string;
};

/**
 * Generate a suggested play pair from thermal + expected move.
 * Returns null if data is insufficient (missing walls, expected move unavailable).
 *
 * Note: Expiry selection is simplified pending approval on design questions (Friday late,
 * weekend earnings, single vs multi-expiry display). For now, uses closest covering expiry.
 */
export function suggestedPlayFromThermal(
  thermal: MeridianEarningsThermalRead | null | undefined,
  expectedMovePct: number | null,
  earningsDate: string | null
): SuggestedPlay | null {
  // Require thermal data + expected move to generate a play.
  if (!thermal?.available || !thermal?.spot || expectedMovePct == null || !earningsDate) {
    return null;
  }

  const { spot, call_wall, put_wall, max_pain } = thermal;
  if (call_wall == null || put_wall == null) {
    return null;
  }

  // Determine directional thesis from wall ratio: call_wall / put_wall.
  // >1.0 = call wall higher, dealer is short call gamma, long put gamma → put primary.
  // <1.0 = put wall higher, dealer is short put gamma, long call gamma → call primary.
  const wallRatio = call_wall / put_wall;
  const primaryIsPut = wallRatio > 1.0;

  // Strike selection: use the walls themselves as the boundaries.
  // Primary strike = the wall in the thesis direction.
  // Hedge strike = the cross-wall.
  // Rationale: the wall is where dealer risk concentrates; positioning there captures regime.
  const primaryStrike = primaryIsPut ? put_wall : call_wall;
  const hedgeStrike = primaryIsPut ? call_wall : put_wall;
  const primarySide = primaryIsPut ? "P" : "C";
  const hedgeSide = primaryIsPut ? "C" : "P";

  // Positioning % = call wall prominence ratio.
  // Expressed as the call wall's share of total wall intensity.
  // Formula: call_wall / (call_wall + put_wall) × 100.
  const positioningPct = Math.round((call_wall / (call_wall + put_wall)) * 100);

  // Expiry selection: use Friday of the same week if available, else Monday.
  // Pending design approval on multi-expiry + weekend behavior.
  const expiry = closestCoveringExpiry(earningsDate);

  // Thesis label: directional if ratio moves > 1.5% away from parity.
  const thesis =
    wallRatio > 1.015
      ? "GEX walls favor puts"
      : wallRatio < 0.985
        ? "GEX walls favor calls"
        : "Walls balanced";

  return {
    primary_strike: Math.round(primaryStrike * 100) / 100,
    primary_side: primarySide,
    hedge_strike: Math.round(hedgeStrike * 100) / 100,
    hedge_side: hedgeSide,
    positioning_pct: positioningPct,
    expiry,
    thesis,
  };
}

/**
 * Closest Friday expiry that covers the earnings print + follow-through window.
 * Simplified: returns next Friday after earnings date.
 * Pending design approval: should this prefer same-week, or day-of + next, or...?
 */
function closestCoveringExpiry(earningsDateStr: string): string {
  const date = new Date(earningsDateStr);
  // Days until next Friday (5 = Friday).
  const dayOfWeek = date.getUTCDay();
  let daysToFriday = (5 - dayOfWeek + 7) % 7;
  if (daysToFriday === 0) daysToFriday = 7; // If today is Friday, go to next Friday.

  const friday = new Date(date);
  friday.setUTCDate(friday.getUTCDate() + daysToFriday);
  return friday.toISOString().split("T")[0];
}

import type { UwGexStrikeExpiryRow } from "@/lib/providers/unusual-whales";

/**
 * Sum per-strike net GEX from a `gex_strike_expiry` WS cell map, optionally
 * restricted to a set of expiries.
 *
 * The cross-validation self-check must compare like-for-like scope: Polygon's
 * primary walls/flip (polygon-options-gex.ts, NEAR_TERM_EXPIRY_COUNT) are
 * deliberately restricted to the near-term expiries only — far-dated
 * monthly/quarterly OI is excluded on purpose because it would otherwise
 * swamp the actionable near-term walls. This ladder previously always summed
 * EVERY stored expiry unconditionally, so for SPX (where standard monthly/
 * quarterly OpEx concentrates enormous OI on far strikes) the two sides were
 * answering different questions — producing hundreds of points of spurious
 * "divergence" against an internally-correct near-term Polygon computation.
 * Passing `allowedExpiries` scopes this ladder to match.
 */
export function ladderFromGexStrikeExpiryCells(
  cells: ReadonlyMap<string, UwGexStrikeExpiryRow>,
  allowedExpiries?: readonly string[]
): { ladder: Map<number, number>; cell_count: number } {
  const allowSet = allowedExpiries && allowedExpiries.length > 0 ? new Set(allowedExpiries) : null;
  const ladder = new Map<number, number>();
  let cellCount = 0;
  for (const row of cells.values()) {
    if (allowSet && !allowSet.has(row.expiry)) continue;
    ladder.set(row.strike, (ladder.get(row.strike) ?? 0) + row.net_gex);
    cellCount += 1;
  }
  return { ladder, cell_count: cellCount };
}

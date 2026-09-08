import { wallsFromStrikeTotals } from "@/lib/providers/gex-cross-validation-core";

/**
 * Recompute walls + flip from FILTERED per-strike totals so the levels track the
 * selected expiry scope:
 *  - call/pos wall = strike of the max positive total, constrained ABOVE spot
 *  - put/neg wall  = strike of the min (most negative) total, constrained BELOW spot
 *  - flip = the per-strike sign crossing (negative→positive as strike ascends) nearest
 *    spot, linearly interpolated between the bracketing strikes. Falls back to the
 *    strike of smallest |total| if no clean crossing exists. Matches the server's
 *    `computeZeroGammaFlip`, which also keys on neg→pos only.
 * Returns nulls when there's nothing to compute (so callers can defer to server levels).
 *
 * Uses `wallsFromStrikeTotals` (side-constrained) rather than the unconstrained
 * `gexWallsFromStrikeTotals` — this used to call the unconstrained sibling without passing
 * `spot`, reintroducing the exact inversion PR #3214 fixed server-side in `computeGexRegime`:
 * a "call wall" landing below spot (read as resistance already broken) or a "put wall" above it
 * (read as support not yet reached). That regression only fired on the per-expiry-FILTERED Key
 * Levels row and profile wall markers — the unscoped/"All" path was already safe because it just
 * keeps the server's already-constrained `call_wall`/`put_wall`.
 */
export function recomputeLevels(
  totals: Record<string, number>,
  spot: number
): { posWall: number | null; negWall: number | null; flip: number | null } {
  // Guard against invalid spot (NaN, infinite, or ≤0) that could corrupt the flip calculation.
  if (!Number.isFinite(spot) || spot <= 0) return { posWall: null, negWall: null, flip: null };

  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  if (entries.length === 0) return { posWall: null, negWall: null, flip: null };

  const { callWall: posWall, putWall: negWall } = wallsFromStrikeTotals(totals, spot);

  let flip: number | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]!;
    const b = entries[i]!;
    if (a.value === 0 || b.value === 0) continue;
    if (a.value < 0 && b.value > 0) {
      const t = Math.abs(a.value) / (Math.abs(a.value) + Math.abs(b.value));
      const cross = a.strike + t * (b.strike - a.strike);
      const dist = spot > 0 ? Math.abs(cross - spot) : 0;
      if (dist < bestDist) {
        bestDist = dist;
        flip = Math.round(cross);
      }
    }
  }
  // Fallback: no clean crossing — the strike of smallest |total| is the nearest pivot.
  if (flip == null) {
    let best = Infinity;
    for (const e of entries) {
      const a = Math.abs(e.value);
      if (a < best) {
        best = a;
        flip = e.strike;
      }
    }
  }
  return { posWall, negWall, flip };
}

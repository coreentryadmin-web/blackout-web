/**
 * Shared geometry primitives for Vector chart paint layers (heatmap, gamma surface, etc.).
 * Pure + DOM-free — unit-testable without a canvas or chart.
 */

export type Band = { lo: number; hi: number };

/**
 * Turn a per-index array of axis coordinates (some possibly unresolvable → null) into per-index
 * [lo,hi] bands that TILE the axis with no gaps or overlaps: each cell spans the midpoints to its
 * resolved neighbours, and an end cell is mirrored across its centre so it's as wide as its single
 * neighbour gap. Works for either axis direction (time coords increase, strike coords decrease) via
 * min/max, and skips indices whose coordinate is null (e.g. a time the scale can't place) → those
 * cells simply aren't drawn (honest). A single lone coordinate yields no band (no width to derive).
 */
export function bandEdges(coords: ReadonlyArray<number | null>): Array<Band | null> {
  const n = coords.length;
  const out: Array<Band | null> = new Array(n).fill(null);
  const resolved: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    if (c != null && Number.isFinite(c)) resolved.push(i);
  }
  if (resolved.length < 2) return out;

  for (let k = 0; k < resolved.length; k++) {
    const i = resolved[k]!;
    const c = coords[i]!;
    const left = k > 0 ? coords[resolved[k - 1]!]! : null;
    const right = k < resolved.length - 1 ? coords[resolved[k + 1]!]! : null;
    const edges: number[] = [];
    if (left != null) edges.push((left + c) / 2);
    if (right != null) edges.push((right + c) / 2);
    if (edges.length === 1) edges.push(c - (edges[0]! - c));
    out[i] = { lo: Math.min(edges[0]!, edges[1]!), hi: Math.max(edges[0]!, edges[1]!) };
  }
  return out;
}

/**
 * NODE DENSITY — member control over how many strike rows (wall guides + bead trails) the chart
 * draws per side.
 *
 * Member ask (2026-08-18): "why dont we add a toggle for nodes? Like 6, 8, 10, 12 … but you can
 * design it for me correct based on our data."
 *
 * The ladder below is derived from what the pipeline can actually supply, not from a round number:
 *
 *  - The recorder stores `VECTOR_WALL_NODES_PER_SIDE = 20` strikes per side per sample. 20 is
 *    therefore a hard ceiling — asking for more would draw rows the server never recorded, i.e.
 *    empty rails that look like missing data.
 *  - Measured row supply after the hysteresis pass (#2309): SPX carries ~28 continuously-present
 *    rows across both sides, single names 16-21. So 20/side is reachable on an index and
 *    saturating on a single name, which is exactly where a ladder should stop.
 *  - The chart's automatic count (`wallCountForTimeframe`) already walks 6 → 20 with the timeframe,
 *    because a wider price band deserves more, further-out walls. The manual steps are a subset of
 *    that same walk so AUTO and a manual pick are never in different units.
 *
 * AUTO (default) follows the timeframe walk (6 → 20) on dense ladders like SPX. On coarse single-name
 * ladders it self-limits so candles keep ≥20% of the price-axis span (see vector-adaptive-nodes.ts).
 * Manual picks override and accept smaller candles.
 */

import { VECTOR_WALL_NODES_PER_SIDE } from "@/features/vector/lib/vector-bar-timeframes";

/** `"auto"` follows the timeframe heuristic; a number pins the per-side row count. */
export type VectorNodeDensity = "auto" | 6 | 8 | 12 | 16 | 20;

export const VECTOR_NODE_DENSITY_OPTIONS: readonly VectorNodeDensity[] = [
  "auto",
  6,
  8,
  12,
  16,
  20,
] as const;

export const VECTOR_DEFAULT_NODE_DENSITY: VectorNodeDensity = "auto";

const STORAGE_KEY = "vector-node-density";

/**
 * Resolve the row count the chart should draw.
 *
 * `autoCount` is `wallCountForTimeframe(tf)` (or `wallCountForHorizon`) — whatever the caller
 * already computes. A manual pick is clamped to [1, VECTOR_WALL_NODES_PER_SIDE]: the upper bound
 * is the recorder's own cap, so no setting can ask for rows that were never persisted, and the
 * lower bound keeps at least one row rather than silently emptying the rail.
 */
export function resolveNodeCount(density: VectorNodeDensity, autoCount: number): number {
  const auto = Math.max(1, Math.min(VECTOR_WALL_NODES_PER_SIDE, Math.floor(autoCount || 0) || 1));
  if (density === "auto") return auto;
  const n = Math.floor(density);
  if (!Number.isFinite(n) || n <= 0) return auto;
  return Math.max(1, Math.min(VECTOR_WALL_NODES_PER_SIDE, n));
}

/** Narrow an unknown (localStorage, URL param) to a supported density, else null. */
export function parseNodeDensity(raw: unknown): VectorNodeDensity | null {
  if (raw === "auto") return "auto";
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return (VECTOR_NODE_DENSITY_OPTIONS as readonly (string | number)[]).includes(n)
    ? (n as VectorNodeDensity)
    : null;
}

/** Toolbar label. AUTO shows the count it resolved to, so the control never reads as inert. */
export function nodeDensityLabel(density: VectorNodeDensity, autoCount: number): string {
  return density === "auto" ? `AUTO ${resolveNodeCount("auto", autoCount)}` : String(density);
}

/**
 * The member's pick persists across reloads and ticker switches — it is a workspace preference
 * (like the indicator set), not per-symbol state. Both sides swallow their errors: a desk that
 * cannot read localStorage (private mode, blocked storage) must still render, on the default.
 */
export function loadNodeDensity(): VectorNodeDensity {
  try {
    return parseNodeDensity(window.localStorage.getItem(STORAGE_KEY)) ?? VECTOR_DEFAULT_NODE_DENSITY;
  } catch {
    return VECTOR_DEFAULT_NODE_DENSITY;
  }
}

export function saveNodeDensity(density: VectorNodeDensity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(density));
  } catch {
    /* best-effort — the session still honours the in-memory pick */
  }
}

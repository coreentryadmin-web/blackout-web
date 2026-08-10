/**
 * RAIL LEVEL LADDER — turn four unordered price fields into a readable structural map.
 *
 * WHY THIS EXISTS, with the live case that forced it. On 2026-08-10 the rail served SPX as
 * `spot 7754.88 · call_wall 7800 · put_wall 8000 · gamma_flip 7772 · max_pain 7500`. The put wall
 * sits ABOVE spot, and above the call wall — which reads like a bug and is not one. `computeGexWalls`
 * ranks each SIGN BUCKET by share of total |gamma|, not by proximity to spot, so `putWalls[0]` is
 * the largest-magnitude negative-gamma strike wherever it happens to sit. Verified live against the
 * ladder: 8000 carried -1.276B vs 7400's -1.214B, and `gex-positioning` and `gex-heatmap` both
 * served the identical 8000. The number is right and must not be "corrected" — the rail is a second
 * VIEW of one source, and re-picking the wall here would make it the only surface in the product
 * disagreeing with the Vector chart.
 *
 * What WAS wrong is that a bare "PUT WALL 8000" invites the member to read support at a level 3.2%
 * the wrong way. A label/price pair carries no geometry. A ladder does: sorted by price with spot
 * marked in its true position, "the put wall is above us" is the first thing the eye gets, and no
 * number had to change to say it.
 *
 * PURE AND TOTAL: no IO, no throw, no clock. Nulls in, fewer rows out — never a fabricated row.
 */

/**
 * `level` is the generic rung — VWAP, prior high/low, a gamma magnet. The answer card's DECISION
 * LEVELS block draws from a wider label set than the rail's four structural fields, and forcing
 * those into one of the named kinds would either drop them or mislabel them.
 */
export type RailLevelKind = "call-wall" | "put-wall" | "gamma-flip" | "max-pain" | "spot" | "level";

export type RailLevelInput = {
  label: string;
  price: number | null;
  kind: RailLevelKind;
};

export type RailLadderRow = {
  label: string;
  kind: RailLevelKind;
  price: number;
  /** Signed % from spot. `null` when spot is unreadable — a distance with no origin is not a number. */
  distancePct: number | null;
  /** True for the synthetic spot row, so the renderer can mark the member's actual position. */
  isSpot: boolean;
};

/**
 * Build the ladder: every readable level plus spot, ordered high price first (a DOM ladder reads
 * downward, and every desk tool in this product already does).
 *
 * Levels with a null price are DROPPED, not rendered as 0 — "we could not read the call wall" and
 * "the call wall is 0" are different claims and only one of them is ever true. A level that ties
 * spot exactly keeps its own row: coincidence is information (spot pinned ON the flip is the whole
 * gamma story) and collapsing it would delete that.
 */
export function buildLevelLadder(spot: number | null, levels: readonly RailLevelInput[]): RailLadderRow[] {
  const rows: RailLadderRow[] = [];

  for (const l of levels) {
    if (l.price == null || !Number.isFinite(l.price)) continue;
    rows.push({
      label: l.label,
      kind: l.kind,
      price: l.price,
      distancePct: spot != null && Number.isFinite(spot) && spot > 0 ? ((l.price - spot) / spot) * 100 : null,
      isSpot: false,
    });
  }

  if (spot != null && Number.isFinite(spot)) {
    rows.push({ label: "SPOT", kind: "spot", price: spot, distancePct: 0, isSpot: true });
  }

  // Price descending. Ties break with spot LAST so a level pinned exactly at spot renders above the
  // marker — the level is the structure, the marker is where we are inside it.
  rows.sort((a, b) => b.price - a.price || Number(a.isSpot) - Number(b.isSpot));
  return rows;
}

/** "+0.58%" / "−3.29%" / "—". A true minus sign, not a hyphen: these sit in a monospace column. */
export function formatDistance(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Math.abs(pct) < 0.005 ? 0 : pct;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(2)}%`;
}

/**
 * Which levels MOVED between two rail reads.
 *
 * A wall migrating is desk signal in its own right — dealers repositioning shows up here before it
 * shows up in price — and the rail refreshing silently in place destroys exactly that information:
 * the member looks away at 7800 and back at 7850 with nothing to say it changed.
 *
 * Compared by LABEL, and only where BOTH reads have a price. A level that appears for the first
 * time has not "moved" — we simply could not see it before, and flagging that as movement would
 * turn a recovering data feed into a fake structural event.
 */
export function movedLevels(
  prev: readonly RailLadderRow[] | null | undefined,
  next: readonly RailLadderRow[]
): Set<string> {
  const moved = new Set<string>();
  if (!prev?.length) return moved;
  const before = new Map(prev.filter((r) => !r.isSpot).map((r) => [r.label, r.price]));
  for (const r of next) {
    if (r.isSpot) continue;
    const was = before.get(r.label);
    if (was != null && was !== r.price) moved.add(r.label);
  }
  return moved;
}

/**
 * Age of a rail read, in seconds, from its `as_of` stamp.
 *
 * Returns null for a missing or unparseable stamp rather than 0 — "we don't know how old this is"
 * must not render as "this is current", which is the single most dangerous rounding on a desk.
 * Negative skew (server clock slightly ahead) clamps to 0; it is not evidence of a future read.
 */
export function readAgeSeconds(asOf: string | null | undefined, now: number): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/** How old a rail read may be before it is called out. One refresh interval plus slack. */
export const RAIL_STALE_AFTER_SEC = 150;

import { relStrengthT, beadRadiusForNotional, pctToNotionalProxy } from "./vector-wall-visual";

/**
 * Pure colour / size / identity helpers for the Vector bead rail.
 *
 * Split out of `vector-wall-rail-primitive.ts` for the reason the repo already uses `-core` files:
 * the primitive implements lightweight-charts' `ISeriesPrimitive` and only runs with a live chart
 * and a canvas context, so none of it can be exercised under `tsx --test`. These four functions
 * decide how big a bead is, how opaque, and whether two frames are talking about the SAME bead —
 * i.e. everything about the rail that can be wrong without throwing.
 *
 * The bead MAGNITUDE ladder (relStrengthT / beadRadiusForNotional / pctToNotionalProxy) lives in
 * vector-wall-visual.ts and is already covered there; this file composes it, it does not restate it.
 */

/** Bead half-height (radius) bounds in px. */
export const HALF_PX_MIN = 2.4;
export const HALF_PX_MAX = 9;

/** Bead fill opacity bounds. */
export const FILL_ALPHA_MIN = 0.6;
export const FILL_ALPHA_MAX = 0.98;

const HEX_6 = /^#[0-9a-fA-F]{6}$/;
const HEX_3 = /^#[0-9a-fA-F]{3}$/;

/**
 * "#rrggbb" / "#rgb" → `rgba(r, g, b, a)`. Anything else is returned unchanged for the caller's
 * `globalAlpha` to carry.
 *
 * VALIDATES THE HEX BEFORE PARSING IT. The previous version tested only `startsWith("#")` and the
 * string LENGTH, then ran `parseInt` on the slices — so a malformed value of the right length
 * (`"#gggggg"`, `"#12345z"`, a truncated CSS variable) produced `rgba(NaN, NaN, NaN, 1)`. Canvas
 * treats an unparseable fillStyle as a no-op: it keeps the PREVIOUS style rather than throwing, so
 * the failure mode is beads silently drawn in the wrong colour, or not distinguishable at all —
 * on the panel whose entire job is showing where the walls are. Falling through to the raw string
 * at least lets the browser's own colour parser reject it visibly.
 */
export function withA(color: string, a: number): string {
  const alpha = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1));
  if (HEX_6.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (HEX_3.test(color)) {
    const r = parseInt(color[1]! + color[1]!, 16);
    const g = parseInt(color[2]! + color[2]!, 16);
    const b = parseInt(color[3]! + color[3]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/**
 * TARGET bead half-height (radius) in px — ABSOLUTE-magnitude first, frame-relative fallback.
 *
 * Scale-independent (a pure function of the point's magnitude) so the rAF easing loop can move it
 * without touching the chart's time/price scales.
 *
 * Absolute path: a resolvable $ notional — a real `StrikeTrailPoint.notional` if one is ever
 * threaded through, else the documented proxy from pct — sizes the bead on the perceptual $ ladder,
 * so a genuinely bigger wall reads bigger regardless of what else is in frame. Fallback: with no
 * usable magnitude at all (pct <= 0 / non-finite) drop to the frame-relative half-height, so
 * off-hours or degraded data still renders a rail instead of collapsing to the floor.
 */
export function targetHalfPx(pct: number, notional: number | undefined, maxPct: number): number {
  const usd =
    Number.isFinite(notional) && (notional as number) > 0 ? (notional as number) : pctToNotionalProxy(pct);
  if (usd > 0) return beadRadiusForNotional(usd, { floorPx: HALF_PX_MIN, ceilPx: HALF_PX_MAX });
  return HALF_PX_MIN + relStrengthT(pct, maxPct) * (HALF_PX_MAX - HALF_PX_MIN);
}

/** Bead fill opacity from its strength relative to the strongest wall in frame. */
export function fillAlpha(pct: number, maxPct: number): number {
  return FILL_ALPHA_MIN + relStrengthT(pct, maxPct) * (FILL_ALPHA_MAX - FILL_ALPHA_MIN);
}

/**
 * Stable per-bead key for the easing maps: side + strike + bucket time.
 *
 * The leading bucket keeps a stable key across refreshes while its pct updates, so ITS bead eases
 * (grows/shrinks) while settled historical beads — unchanged key, unchanged target — never move.
 * Get this wrong in either direction and the rail either jitters on every poll or freezes.
 */
export function beadKey(side: "c" | "p", strike: number, time: number): string {
  return `${side}:${strike}:${time}`;
}

/** Per-strike king-emphasis key (side + strike, no time — the king persists across buckets). */
export function kingKey(side: "c" | "p", strike: number): string {
  return `${side}:${strike}`;
}

/**
 * Price-range extension so the chart's visible band includes the dealer walls,
 * not just the intraday candles.
 *
 * The bug this fixes: lightweight-charts autoscales the price axis to the candle
 * series only. Wall price-lines and bead markers never widen the range, so any
 * wall outside the intraday candle band renders OFF-SCREEN. In a long-gamma
 * session the put (support) walls often sit a few % below spot — well below the
 * tight candle band — so the member saw only the yellow call rails and NO purple
 * put beads, even though the put walls were computed and drawn (just clipped).
 *
 * Fix: union the candle-derived range with any wall strikes within ±maxPct of
 * spot. Only extends when a wall is actually outside the candle band (walls
 * already in view cost nothing), and the ±maxPct cap keeps a very far, weak wall
 * from squishing the candles into a sliver. Pure + testable; the chart calls it
 * from the candle series' autoscaleInfoProvider.
 */

export type PriceRange = { minValue: number; maxValue: number };

/** Default: densely reveal EVERY wall up to 5% from spot. Beyond that we still reveal the single
 *  NEAREST wall on each side (see below) but stop pulling in the whole cluster. Env-tunable. */
export const DEFAULT_WALL_VIEW_MAX_PCT = 0.05;

/** Hard cap for the "always reveal the nearest wall each side" guarantee. In a long-gamma session
 *  the closest put (support) wall can sit 6-10% below spot — just past the 5% dense window — which
 *  is exactly why members saw only the yellow call rails and NO purple put beads (the put wall was
 *  computed and drawn, just clipped off the bottom). We always pull the nearest call AND nearest
 *  put into view up to this cap so BOTH colors show whenever real walls exist, without letting a
 *  pathologically far wall squish the candles into a sliver. */
export const NEAREST_WALL_VIEW_MAX_PCT = 0.12;

/** Reveal cap for the ACTUALLY-DRAWN bead rows (the session-trail strikes the chart renders as
 *  beads), independent of the current-ladder wall caps above. The bug it fixes: the axis widened
 *  only for the LIVE ladder's top-N strikes, but beads are drawn from the whole-session trail —
 *  so a bead at a strike not in the current ladder was clipped, and because zoom re-runs autoscale
 *  off the now-fewer visible candles, those beads would VANISH on zoom-in and reappear on zoom-out.
 *  Feeding the drawn-bead strikes through this wider cap keeps every drawn bead in view at every
 *  zoom level (the Skylit "wide rail" look), while still bounding a pathological outlier so it
 *  can't squash the candles to a sliver. Wider than the ladder caps because the drawn set is
 *  already curated (top-N by strength per side), so revealing all of it is intended, not noise. */
export const BEAD_VIEW_MAX_PCT = 0.2;

/** Compare 4-up: slightly wider bead autoscale so more strike rows stay in frame when panes are short. */
export const COMPARE_BEAD_VIEW_MAX_PCT = 0.24;

/** Session overview first paint — only nearby bead rows widen the axis (not the full 20% trail). */
export const SESSION_OVERVIEW_BEAD_VIEW_MAX_PCT = 0.03;

/** Hard cap on total vertical span on session overview so candles + beads read large (member ref: image 2). */
export const SESSION_OVERVIEW_MAX_SPAN_PCT = 0.024;

export function filterStrikesNearSpot(
  strikes: readonly number[],
  spot: number,
  maxPct: number
): number[] {
  if (!(spot > 0) || !(maxPct > 0)) return strikes.filter((s) => Number.isFinite(s) && s > 0);
  const floor = spot * (1 - maxPct);
  const ceil = spot * (1 + maxPct);
  return strikes.filter((s) => Number.isFinite(s) && s > 0 && s >= floor && s <= ceil);
}

/** Clamp an over-wide autoscale band to a spot-centered window while keeping the candle range visible. */
export function clampPriceRangeSpan(
  range: PriceRange,
  spot: number,
  maxSpanPct: number,
  mustInclude: PriceRange
): PriceRange {
  if (!(spot > 0) || !(maxSpanPct > 0)) return range;
  const span = range.maxValue - range.minValue;
  const maxSpan = spot * maxSpanPct;
  if (!Number.isFinite(span) || span <= maxSpan) return range;

  let min = spot - maxSpan / 2;
  let max = spot + maxSpan / 2;
  if (mustInclude.minValue < min) {
    min = mustInclude.minValue;
    max = min + maxSpan;
  }
  if (mustInclude.maxValue > max) {
    max = mustInclude.maxValue;
    min = max - maxSpan;
  }
  return { minValue: min, maxValue: max };
}

export function extendRangeForWalls(
  base: PriceRange,
  spot: number | null | undefined,
  callStrikes: readonly number[],
  putStrikes: readonly number[],
  maxPct: number = DEFAULT_WALL_VIEW_MAX_PCT,
  nearestMaxPct: number = NEAREST_WALL_VIEW_MAX_PCT
): PriceRange {
  let { minValue, maxValue } = base;
  if (!(typeof spot === "number" && spot > 0) || !(maxPct > 0)) return { minValue, maxValue };

  const floor = spot * (1 - maxPct);
  const ceil = spot * (1 + maxPct);

  // Call walls sit above spot (resistance) → they can push the TOP of the range up.
  for (const s of callStrikes) {
    if (Number.isFinite(s) && s > 0 && s <= ceil && s > maxValue) maxValue = s;
  }
  // Put walls sit below spot (support) → they can push the BOTTOM of the range down.
  for (const s of putStrikes) {
    if (Number.isFinite(s) && s > 0 && s >= floor && s < minValue) minValue = s;
  }

  // ALWAYS reveal the nearest wall on each side, even a bit past the dense window (up to the hard
  // cap), so both call (gold) and put (purple) beads are visible whenever the walls exist — the
  // fix for "I only see yellow beads." Nearest = closest strike to spot on that side.
  const hardCeil = spot * (1 + nearestMaxPct);
  const hardFloor = spot * (1 - nearestMaxPct);
  let nearestCall = Infinity;
  for (const s of callStrikes) {
    if (Number.isFinite(s) && s > spot && s <= hardCeil && s < nearestCall) nearestCall = s;
  }
  if (Number.isFinite(nearestCall) && nearestCall > maxValue) maxValue = nearestCall;
  let nearestPut = 0;
  for (const s of putStrikes) {
    if (Number.isFinite(s) && s > 0 && s < spot && s >= hardFloor && s > nearestPut) nearestPut = s;
  }
  if (nearestPut > 0 && nearestPut < minValue) minValue = nearestPut;

  // Small pad on any side we extended, so a revealed bead isn't flush to the frame edge.
  const span = maxValue - minValue;
  if (span > 0) {
    const pad = span * 0.02;
    if (maxValue > base.maxValue) maxValue += pad;
    if (minValue < base.minValue) minValue -= pad;
  }
  return { minValue, maxValue };
}

/**
 * How long after a member's own scroll-zoom the price axis stops widening for walls/beads.
 *
 * Mirrors the chart's wheel cooldown: during an active zoom gesture the axis must hold exactly
 * where the member put it, or the next SSE tick (~1/s in RTH) re-runs autoscale and snaps the view
 * back to the wide wall-inclusive band mid-gesture.
 */
export const BEAD_EXTENSION_WHEEL_COOLDOWN_MS = 8_000;

/**
 * May the price axis widen to include the drawn wall/bead rows right now?
 *
 * ── THE BUG THIS SEPARATES OUT (2026-08-19) ──────────────────────────────────────────
 * The candle series' `autoscaleInfoProvider` used to skip its wall/bead widening whenever
 * `memberViewportLocked(chartUserPanned, wheelZoomAt)` was true. That predicate is correct for what
 * it was built for — suppressing programmatic TIME-axis refits and auto-coarsen once the member has
 * taken control — but `chartUserPanned` is also set PROGRAMMATICALLY by the intraday zoom presets:
 * `handleIntradayZoom` sets it for `structure` and `live` so the preset's own range is not
 * immediately refitted away. Nothing clears it until a `session` reset.
 *
 * So pressing STRUCTURE or LIVE permanently disabled the price-axis widening, and the axis
 * collapsed to the candle range for the rest of the session. Measured on prod at the `structure`
 * preset:
 *
 *     SPX   axis 7680.00 - 7772.00   span 1.20% of spot   ~14 bead rows visible
 *     NVDA  axis  218.70 -  220.90   span 1.00% of spot     1 bead row visible
 *
 * Both rails are healthy underneath — the real client pipeline (bucket -> lifecycle ->
 * pickActiveStrikes) yields 7-10 rows per side for NVDA off the very same payload. The rows are
 * produced and then clipped, because a STRIKE STEP is ~0.065% of price on SPX and ~1.14% on NVDA:
 * a candle-only band holds a dozen SPX strikes and less than one NVDA strike. That is why the
 * defect reads as "NVDA only has one level while SPX has ten" and looks ticker-specific when the
 * cause is a shared flag with two meanings.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * Only a member's OWN recent zoom gesture suppresses the widening. A time-axis preset is not a
 * statement about the price axis. Drag-panning is not either — and it does not need to be covered
 * here, because a member who drags the price scale turns `autoScale` off outright, at which point
 * lightweight-charts stops consulting the provider at all.
 */
export function beadExtensionAllowed(
  wheelZoomAtMs: number,
  nowMs: number = Date.now(),
  cooldownMs: number = BEAD_EXTENSION_WHEEL_COOLDOWN_MS
): boolean {
  if (!Number.isFinite(wheelZoomAtMs) || wheelZoomAtMs <= 0) return true;
  return !(nowMs - wheelZoomAtMs < cooldownMs);
}

/**
 * Turn "show N bead rows" into a price-span percentage, using the ticker's OWN strike geometry.
 *
 * ── WHY A PERCENTAGE CANNOT BE THE SPEC (2026-08-19) ─────────────────────────────────
 * `SESSION_OVERVIEW_BEAD_VIEW_MAX_PCT` (3%) and `SESSION_OVERVIEW_MAX_SPAN_PCT` (2.4%) were both
 * tuned against a member reference screenshot — of SPX. A percentage of price is a fine unit for
 * "how much chart to show" and a useless one for "how many strike rows fit", because the strike
 * LADDER is not proportional to price:
 *
 *     SPX   5-pt strikes at ~7690  ->  0.065% per step  ->  2.4% spans ~37 rows
 *     NVDA  $2.50 strikes at ~219  ->  1.14%  per step  ->  2.4% spans  ~2 rows
 *
 * Same constant, same code, a 18x difference in how much of the rail a member is allowed to see.
 * That is the second half of "why does NVDA have only one level while SPX has ten" — the first half
 * being the viewport-lock bug fixed alongside this. Neither is a recorder, roster or row-selection
 * problem: both rails are fully recorded and 7-10 rows per side are selected for drawing.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * Ask the strikes how wide a row is, and size the window to hold `rows` of them. The percentage
 * survives as a FLOOR (never shrink a view that was already fine — SPX is unaffected, since 37 rows
 * of room already exceeds any row cap) and a separate hard cap survives as the ceiling, so a
 * pathological ladder still cannot squash the candles to a sliver.
 *
 * Falls back to `basePct` whenever the geometry cannot be measured — fewer than two strikes, a
 * missing spot, a degenerate step. An unmeasurable ladder must degrade to today's behaviour, never
 * to an invented window.
 */
export function rowAwareSpanPct(
  spot: number,
  strikes: readonly number[],
  rows: number,
  basePct: number,
  hardCapPct: number
): number {
  const base = Number.isFinite(basePct) && basePct > 0 ? basePct : 0;
  const cap = Number.isFinite(hardCapPct) && hardCapPct > 0 ? hardCapPct : base;
  if (!(typeof spot === "number" && Number.isFinite(spot) && spot > 0)) return base;
  if (!(Number.isFinite(rows) && rows >= 1)) return base;

  const sorted = [...new Set(strikes.filter((s) => Number.isFinite(s) && s > 0))].sort((a, b) => a - b);
  if (sorted.length < 2) return base;

  // MEDIAN adjacent gap, not mean: a ladder mixes a dense near-spot region with sparse far wings
  // (SPX lists 5-pt strikes near spot and 25-pt strikes far out), and a mean would be dragged by
  // the wings into a window far wider than the rows a member actually reads.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return base;
  gaps.sort((a, b) => a - b);
  const step = gaps[Math.floor(gaps.length / 2)]!;

  // `rows` counts rows across the whole window, so the span is (rows - 1) steps plus half a step of
  // padding at each end — otherwise the outermost row sits exactly on the frame edge and reads as
  // clipped even though it was included.
  const neededSpan = step * rows;
  const pct = neededSpan / spot;
  if (!Number.isFinite(pct) || pct <= 0) return base;
  return Math.min(cap, Math.max(base, pct));
}

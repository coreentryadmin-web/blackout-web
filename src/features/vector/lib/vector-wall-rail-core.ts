import { relStrengthT, beadRadiusForPctShare } from "./vector-wall-visual";

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

/**
 * Bead half-height (radius) bounds in px.
 *
 * Trimmed 2026-08-09 (member: "it literally paints the candles fully"). The king bead is the ceiling
 * times the KING_RADIUS_BOOST multiplier, so 9 x 1.3 rendered a ~23px-diameter dot — wide enough to
 * cover the candles it is supposed to annotate. Ceiling 9 -> 7.5 and the floor 2.4 -> 2.2, which
 * takes the king to ~18px while keeping the dynamic range (fat king vs thin straggler) at ~3.4x,
 * essentially unchanged from the previous 3.75x. A deliberately small trim: the rail's whole job is
 * that a dominant wall READS as dominant, so shrinking it toward uniformity would trade one
 * complaint for a worse one.
 */
export const HALF_PX_MIN = 2.2;
export const HALF_PX_MAX = 7.5;

/** Bead fill opacity bounds — full strength for regular beads; king glow is tamed in the draw pass only. */
export const FILL_ALPHA_MIN = 0.6;
export const FILL_ALPHA_MAX = 0.98;

/** Render profile — Compare panes are ~¼ height; default bead sizing paints over candles. */
export type WallBeadRenderProfile = "default" | "compare";

export type BeadRenderTuning = {
  halfMin: number;
  halfMax: number;
  fillMin: number;
  fillMax: number;
  /** King radius multiplier in the canvas draw pass. */
  kingBoost: number;
  /** Extra draw-time alpha scale (on top of fillAlpha). */
  drawAlphaMul: number;
  /** Hard cap on KING bead fill only (draw pass) — regular beads keep full strength spread. */
  kingAlphaCap?: number;
  minRadiusPx: number;
  /** King halo radius/opacity scale. */
  kingHaloMul: number;
  /** Strength curve exponent — lower = gentler fade for weak walls (Compare panes). */
  contrastExp?: number;
  /** Modeled (reconstructed) bead alpha scale — dim ghost, not invisible. */
  modeledAlphaScale?: number;
  /** Outline boost so small compare beads stay legible on #040407. */
  strokeAlphaBoost?: number;
};

export const BEAD_TUNING_DEFAULT: BeadRenderTuning = {
  halfMin: HALF_PX_MIN,
  halfMax: HALF_PX_MAX,
  fillMin: FILL_ALPHA_MIN,
  fillMax: FILL_ALPHA_MAX,
  kingBoost: 0.22,
  drawAlphaMul: 1,
  // A LITTLE off the king, not most of it. #2244/#2247 took the halo to 0.38 (a 62% cut) and capped
  // king alpha at 0.72, which flattened the crowned bead into its neighbours — the member asked only
  // that it stop painting over the candles. 0.88 halo / 0.92 cap keeps the king unmistakably the
  // brightest bead on its row while lifting the paint off the candles underneath.
  kingAlphaCap: 0.92,
  minRadiusPx: 1.6,
  /** King-only — regular beads stay bright; this trims the halo that buried candles. */
  kingHaloMul: 0.88,
};

/** ~55% bead radius — keeps level rails readable without burying candles. Contrast retuned
 *  2026-08-15: member compare screenshots — beads read too dim vs Thermal yellow/purple kings. */
export const BEAD_TUNING_COMPARE: BeadRenderTuning = {
  halfMin: 1.5,
  halfMax: 4.5,
  fillMin: 0.58,
  fillMax: 0.96,
  kingBoost: 0.14,
  drawAlphaMul: 1.08,
  minRadiusPx: 1.1,
  kingHaloMul: 0.88,
  contrastExp: 1.12,
  modeledAlphaScale: 0.68,
  strokeAlphaBoost: 0.38,
};

export function beadRenderTuning(profile: WallBeadRenderProfile = "default"): BeadRenderTuning {
  return profile === "compare" ? BEAD_TUNING_COMPARE : BEAD_TUNING_DEFAULT;
}

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

export type TargetHalfPxOpts = {
  /** When false, force frame-relative sizing even if `notional` is present ($ Size off). */
};

/**
 * TARGET bead half-height (radius) in px.
 *
 * Sized off the per-strike gamma SHARE (`pct`) on a LOG ladder — see beadRadiusForPctShare. `pct`
 * is a share of the ticker's OWN book, so every ticker is treated identically, which is the whole
 * point: the previous absolute-$ ladder was calibrated on SPX and clamped 100% of META/TSLA beads
 * to a single size (measured 2026-08-17).
 *
 * `notional` is deliberately NO LONGER the primary channel. It is a real recorded quantity, but an
 * absolute one, and absolute dollars are not comparable across underlyings — which is exactly how
 * the size channel died on single names. It is kept in the signature (and used only as a tie-break
 * when share is unusable) so callers and the recorded payload need no change.
 */
export function targetHalfPx(
  pct: number,
  notional: number | undefined,
  maxPct: number,
  tuning: BeadRenderTuning = BEAD_TUNING_DEFAULT,
  opts?: TargetHalfPxOpts
): number {
  if (Number.isFinite(pct) && pct > 0) {
    return beadRadiusForPctShare(pct, { floorPx: tuning.halfMin, ceilPx: tuning.halfMax });
  }

  // No usable share. Frame-relative is the last resort — with no share there is nothing per-ticker
  // to normalise against, and a bead must still render rather than collapse.
  return tuning.halfMin + relStrengthT(pct, maxPct) * (tuning.halfMax - tuning.halfMin);
}

/**
 * Trailing-reference window for the decay channel, in seconds.
 *
 * 15 minutes: long enough that a wall's recent PEAK stays the reference while it bleeds (so the fade
 * builds and HOLDS rather than flickering), short enough that a wall which genuinely rebuilt stops
 * being judged against an hours-old high.
 */
export const TRAILING_REF_WINDOW_SEC = 900;

/**
 * Per-point trailing reference = the max pct over the window STRICTLY BEFORE each point.
 *
 * "Strictly before" is the whole correctness argument: a bead is compared only to its own past, so
 * its rendered appearance never depends on data that did not exist yet at its bucket. That keeps the
 * rail an honest historical record — the same principle that makes kingStrikeByTime compute the king
 * per bucket instead of painting the current king across the whole session.
 *
 * The first point of a trail has no prior window and returns null (caller renders it neutral): a
 * wall's BIRTH is not a fade, and inventing a reference for it would flag every new wall as decayed.
 *
 * O(n) via a monotonic deque — a per-strike trail can carry thousands of buckets in a session and
 * this runs inside the chart's repaint path.
 */
export function trailingRefs(
  points: ReadonlyArray<{ time: number; pct: number }>,
  windowSec: number = TRAILING_REF_WINDOW_SEC
): Array<number | null> {
  const out: Array<number | null> = new Array(points.length).fill(null);
  // Indices of candidate maxima, pct descending. Front is the window max.
  const deque: number[] = [];
  let head = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!Number.isFinite(p.time)) continue;
    // Evict anything older than the window relative to THIS point.
    while (head < deque.length && points[deque[head]!]!.time < p.time - windowSec) head++;
    out[i] = head < deque.length ? points[deque[head]!]!.pct : null;
    // Push AFTER reading, so a point never references itself.
    if (Number.isFinite(p.pct)) {
      while (deque.length > head && points[deque[deque.length - 1]!]!.pct <= p.pct) deque.pop();
      deque.push(i);
    }
  }
  return out;
}

/** Bead fill opacity from its strength relative to the strongest wall in frame. */
export function fillAlpha(
  pct: number,
  maxPct: number,
  tuning: BeadRenderTuning = BEAD_TUNING_DEFAULT
): number {
  const exp = tuning.contrastExp ?? 1.6;
  if (!Number.isFinite(pct) || pct <= 0 || !(maxPct > 0)) return tuning.fillMin;
  const t = Math.pow(Math.min(1, pct / maxPct), exp);
  return tuning.fillMin + t * (tuning.fillMax - tuning.fillMin);
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

/** Per-strike king-emphasis key (side + strike, no time). Used ONLY for the LIVE bucket's eased
 *  crossfade — historical buckets carry their own frozen kingship, see kingStrikeByTime. */
export function kingKey(side: "c" | "p", strike: number): string {
  return `${side}:${strike}`;
}

/**
 * Which strike was the dominant node AT EACH BUCKET — the king as a function of time.
 *
 * THE BUG THIS EXISTS FOR (member-reported, measured 2026-08-09). King emphasis used to be a single
 * scalar per strike: the primitive picked the strike whose LATEST bucket held the highest share and
 * emphasised that strike's ENTIRE trail. So the crown was painted retroactively across the whole
 * session onto whoever held it at that instant, and stripped retroactively from whoever had lost it.
 * There was no moment on the chart where a king was seen losing it or a challenger taking it — the
 * rail is a historical record, but kingship was rendered as a present-tense property.
 *
 * It is not a cosmetic loss. Measured across the recorded rails for one session (2026-08-07,
 * weekly): every name handed the crown over repeatedly — TSLA 16 handovers, NVDA 57, SPY 64, QQQ 48
 * — and the king's own share swung enormously within the day (TSLA 21%→62%, AAPL 25%→79%). On TSLA
 * the eventual king spent part of the morning near 10% share and still rendered crowned there.
 *
 * The data needed to fix it was already present: every bucket carries each strike's `pct`, so the
 * king at time T is simply the highest-pct strike among the trails at T. No new plumbing.
 *
 * Ties keep the FIRST strike encountered rather than flickering between equals — a tie means two
 * walls are equally dominant, and picking deterministically is better than alternating each repaint.
 */
export function kingStrikeByTime(
  trails: ReadonlyArray<{ strike: number; points: ReadonlyArray<{ time: number; pct: number }> }>
): Map<number, number> {
  const best = new Map<number, { strike: number; pct: number }>();
  for (const trail of trails) {
    if (!Number.isFinite(trail.strike)) continue;
    for (const p of trail.points) {
      if (!Number.isFinite(p.time) || !Number.isFinite(p.pct)) continue;
      const cur = best.get(p.time);
      if (cur == null || p.pct > cur.pct) best.set(p.time, { strike: trail.strike, pct: p.pct });
    }
  }
  const out = new Map<number, number>();
  for (const [time, v] of best) out.set(time, v.strike);
  return out;
}

// ── SPACING BUDGET (2026-08-18) ───────────────────────────────────────────────────────────────
//
// THE DEFECT, seen rather than computed. A live screenshot of /vector at 3m showed the rail as
// solid painted BANDS, not beads: yellow and magenta slabs thick enough to bury the candles they
// annotate. The arithmetic behind it — ~130 three-minute bars across ~700px is **~5.4px of
// horizontal room per bar**, against a bead up to `HALF_PX_MAX * 2 = 15px` wide. Every bead
// overlapped its neighbours roughly threefold, so a row of beads rendered as one smear.
//
// That also DESTROYS the size channel at paint time. The recorded data genuinely carries 46-54
// distinct radii per ticker (measured live across 8 tickers), but when adjacent beads overlap 3x a
// viewer sees their union — a slab of constant thickness. "All the beads look the same size" was a
// fair description of the picture and a wrong description of the data, and both halves of that are
// explained here rather than in the magnitude ladder, which is sound and untouched.
//
// WHY A CONSTANT CANNOT WORK. `HALF_PX_MAX` was already trimmed 9 -> 7.5 for this exact member
// complaint ("it literally paints the candles fully") and the screenshot above is AFTER that trim.
// A fixed pixel radius cannot be right across timeframes: bar spacing moves by an order of
// magnitude between 1m and 1W, and the price-axis gap between adjacent strike rows moves with the
// ticker (5-point SPX strikes vs 0.5-point single-name) and with zoom. The ceiling has to be
// derived from the room actually available, not tuned for one screenshot.

/** Fraction of BAR SPACING a bead's diameter may occupy. Just under 1 so consecutive beads in a row
 *  read as beads with air between them rather than a continuous ribbon. */
const BEAD_BAR_FILL = 0.85;

/** Fraction of the ROW GAP (price-axis distance to the nearest neighbouring row) a bead's diameter
 *  may occupy. Deliberately about half: this is what keeps rows visibly SEPARATE — the property the
 *  reference product has and the slab render did not — and what stops beads burying the candles. */
const BEAD_ROW_FILL = 0.55;

export type BeadSpacingBudget = {
  /** px between adjacent bars on the time axis. */
  barSpacingPx: number;
  /** px between the closest pair of DRAWN strike rows. Infinity when fewer than two rows. */
  rowGapPx: number;
};

/**
 * Shrink a render tuning to the room actually on screen.
 *
 * ONLY EVER SHRINKS. At wide zoom the profile's own `halfMax` still caps the bead — this budget
 * cannot inflate a bead past the size the profile was tuned for, so the Compare pane stays small
 * and the default pane never grows beyond 7.5.
 *
 * The floor/ceiling RATIO is preserved where there is room for it, because that ratio IS the size
 * channel — collapsing `halfMax` while pinning `halfMin` would leave every bead the same size,
 * i.e. the exact perceptual failure this fix exists to remove. Where there is not room (a very
 * dense zoom), the range compresses toward `minRadiusPx` and the size channel genuinely carries
 * less: that is an honest consequence of a crowded axis, not something to paper over by letting
 * beads overlap again.
 *
 * Unusable inputs (NaN, non-positive, a single row → infinite gap) contribute NO constraint, so a
 * missing measurement degrades to the profile's own tuning rather than collapsing the rail.
 */
export function clampTuningToSpacing(
  tuning: BeadRenderTuning,
  budget: BeadSpacingBudget
): BeadRenderTuning {
  const limits: number[] = [tuning.halfMax];
  if (Number.isFinite(budget.barSpacingPx) && budget.barSpacingPx > 0) {
    limits.push((budget.barSpacingPx * BEAD_BAR_FILL) / 2);
  }
  if (Number.isFinite(budget.rowGapPx) && budget.rowGapPx > 0) {
    limits.push((budget.rowGapPx * BEAD_ROW_FILL) / 2);
  }

  const floor = tuning.minRadiusPx > 0 ? tuning.minRadiusPx : 0.5;
  const halfMax = Math.max(floor, Math.min(...limits));
  if (halfMax >= tuning.halfMax) return tuning; // nothing binds — keep the profile exactly

  // Preserve the profile's dynamic range where the new ceiling allows it.
  const ratio = tuning.halfMin > 0 ? tuning.halfMax / tuning.halfMin : 1;
  const halfMin = Math.min(halfMax, Math.max(floor, ratio > 1 ? halfMax / ratio : halfMax));

  return { ...tuning, halfMax, halfMin };
}

/** Closest price-axis gap between drawn rows, from their y coordinates. Infinity for <2 rows —
 *  a single row is unconstrained vertically and must not be shrunk to the floor by a bogus 0 gap. */
export function closestRowGapPx(ys: readonly number[]): number {
  const sorted = [...ys].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    // Two rows resolving to the SAME pixel is a zero gap, which would clamp every bead to the
    // floor. Ignore coincident rows: they are already indistinguishable and constrain nothing.
    if (d > 0.5 && d < gap) gap = d;
  }
  return gap;
}

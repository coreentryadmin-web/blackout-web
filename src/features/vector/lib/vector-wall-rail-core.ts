import { relAlphaT, relStrengthT, beadRadiusForPctShare } from "./vector-wall-visual";

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

/**
 * Bead fill opacity bounds.
 *
 * FLOOR LOWERED 0.6 -> 0.25 (2026-08-18, member screenshot). At 0.6 the ENTIRE contrast budget was
 * 0.6 -> 0.98: the weakest bead on the chart rendered at 60% opacity and the strongest at 98%, a
 * 38-point spread that is not readable as a difference. Every bead in a row therefore looked
 * equally bold whether that wall was heavy or thin at the time, so a row showed only THAT A WALL
 * EXISTED and never WHEN IT MATTERED — which is the whole point of drawing it as a time series.
 *
 * 0.25 leaves a faint-but-present weak bead (the rail still shows structure that is there) while
 * giving the strong end somewhere to stand out from.
 */
export const FILL_ALPHA_MIN = 0.25;
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
  /** Running peak share on this strike row — scales bead height by pct/peak (competitor swell). */
  rowPeakPct?: number | null;
};

/** Floor for row-relative swell multiplier — weakest moment on a row still reads present. */
export const ROW_SWELL_FLOOR = 0.32;

/** Sub-linear exponent — lifts the weak end so a fade is visible without crushing the peak. */
export const ROW_SWELL_EXP = 0.7;

/**
 * Floor for BOOK-relative swell — the denominator is the whole book's peak, not one row's.
 *
 * Much lower than {@link ROW_SWELL_FLOOR} (0.32), and that is the point. A row-relative floor of
 * 0.32 caps the achievable contrast at 1/0.32 = 3.1x, and every row reaches 1.0 on its own terms,
 * so in practice a dominant wall and a marginal one differed by ~1.3x. Against a shared denominator
 * a genuinely weak level SHOULD recede to a faint trace: that is what lets many rows be drawn
 * without the chart turning to mush, since the dynamic range does the decluttering instead of a row
 * cap. 0.15 gives ~6.7x of headroom while keeping the weakest bead visible rather than absent —
 * a level that is present at 2% of book is information, and dropping it entirely would be a lie of
 * omission.
 */
export const BOOK_SWELL_FLOOR = 0.15;

/**
 * Book-relative exponent. Slightly super-linear (>1) rather than the row channel's sub-linear 0.7:
 * sub-linear exists to LIFT a weak end that was being crushed, which is the correct shape when the
 * denominator is the row's own peak and most samples sit near 1. Against the book peak most samples
 * sit far BELOW 1, and lifting them there is exactly what re-flattens the picture, so the curve has
 * to lean the other way.
 */
export const BOOK_SWELL_EXP = 1.15;

/** Minimum half-height range after spacing clamp at ordinary 3m zoom (3px diameter spread). */
export const MIN_CLAMPED_HALF_RANGE_PX = 1.5;

/**
 * Running peak gamma share on one strike row, including the current bucket.
 *
 * Compares each bead to the strongest this wall has been **so far along the row** — the temporal
 * swell/fade read along one strike. Strictly historical: point i never sees pct from i+1.
 */
export function rowPeakRefs(points: ReadonlyArray<{ pct: number }>): number[] {
  let peak = 0;
  return points.map((p) => {
    if (Number.isFinite(p.pct) && p.pct > 0) peak = Math.max(peak, p.pct);
    return peak;
  });
}

/**
 * Row-relative strength in [floor, 1]: 1 at the row's peak so far, tapering as the wall bleeds off.
 */
export function rowSwellMul(
  pct: number,
  rowPeak: number,
  opts?: { floor?: number; exp?: number }
): number {
  const floor = opts?.floor ?? ROW_SWELL_FLOOR;
  const exp = opts?.exp ?? ROW_SWELL_EXP;
  if (!Number.isFinite(pct) || pct <= 0 || !(rowPeak > 0)) return floor;
  const t = Math.min(1, pct / rowPeak);
  return floor + Math.pow(t, exp) * (1 - floor);
}

/**
 * Extra strength-halo radius beyond the core bead at full row-relative strength.
 * The halo carries temporal swell/fade — peak moments bloom, faded tail is a faint trace.
 */
export const ROW_HALO_EXTRA_MIN_PX = 0.25;
export const ROW_HALO_EXTRA_MAX_PX = 7;

/** Steeper than {@link ROW_SWELL_EXP} — halo collapses faster on fade so peaks read as clusters. */
export const ROW_HALO_SWELL_EXP = 1.75;

export type RowStrengthHaloOpts = {
  minPx?: number;
  maxPx?: number;
  /** Chart bar spacing in px — caps peak corona so dense 3m swells bloom without a uniform slab. */
  barSpacingPx?: number;
  /**
   * Price-axis distance to the nearest neighbouring row, in px.
   *
   * THE HALO IS DRAWN IN BOTH AXES AND WAS ONLY EVER BUDGETED IN ONE (fixed 2026-08-19). The core
   * bead obeys BEAD_ROW_FILL (0.55 of the row gap), but the halo is added ON TOP of it and was
   * capped against bar spacing alone — a HORIZONTAL measure. Vertically it was unbounded, so at any
   * zoom where bars are wide relative to strike spacing the corona grew past the row gap and
   * neighbouring rows fused.
   *
   * Measured on prod during RTH: band thickness / nearest row gap reached 1.58 on QQQ and exceeded
   * 1.0 on 15 of 21 frames — a ratio above 1.0 means the bead is literally thicker than the space
   * to its neighbour. Member report: "dont you think it paints too hard like too thick for the
   * strong nodes". The reference product runs visibly under 0.50.
   */
  rowGapPx?: number;
  /**
   * The core bead's ACTUAL half-height at this bucket, in px.
   *
   * The budget has to cover core + halo TOGETHER, and the first version of this fix did not: it
   * capped the halo alone at ROW_HALO_ROW_GAP_FILL while the core independently took BEAD_ROW_FILL,
   * summing to 1.25 of the row gap — still a slab, just a differently-derived one. The unit test
   * on the SUM caught it; neither function was wrong on its own, which is exactly why the invariant
   * belongs on the sum rather than on either radius.
   *
   * Passing the real core radius (not its ceiling) means a weak bead, whose core is small, still
   * gets to bloom — the budget only binds where it actually needs to.
   */
  coreHalfPx?: number;
};

/**
 * Horizontal px between adjacent bucket centers when beads are projected WITHIN candles.
 * Exported for tests and spacing audits — not used to zero the halo (swell ratio is the guard).
 */
export function beadCenterSpacingPx(
  barSpacingPx: number,
  intervalSec: number,
  trailSec = 5
): number {
  if (!(barSpacingPx > 0) || !(intervalSec > 0) || !(trailSec > 0)) return NaN;
  return barSpacingPx * (trailSec / intervalSec);
}

/** Peak corona budget scales with bar width — ~55% of a bar at full row swell. */
export const ROW_HALO_BAR_SPACING_FILL = 0.55;

/**
 * Fraction of the ROW GAP that core bead + halo together may occupy at full swell.
 *
 * The counterpart to {@link ROW_HALO_BAR_SPACING_FILL} on the axis that matters for legibility.
 * Measured on prod during RTH before this existed: band thickness / nearest row gap ran a median
 * p90 of 0.64 and exceeded 1.0 on 15 of 21 frames (worst 1.58 on QQQ) — above 1.0 the bead is
 * thicker than the distance to its neighbour, so rows touch and the candles behind vanish.
 *
 * 0.7 leaves ~30% of every slot as air. Not lower, because the whole point of the rail is that a
 * dominant wall READS as dominant, and squeezing the peak toward the floor trades this complaint
 * for the opposite one — which is the exact oscillation #2310 and #2244 already went through once.
 */
export const ROW_HALO_ROW_GAP_FILL = 0.7;

/**
 * Strength halo radius beyond core bead — grows with row swell, fades to a trace.
 *
 * Peak beads at a row's strongest moment get a wide soft corona (overlapping halos = the glowing
 * cluster in the reference product). Faded beads get near-zero extra radius so gaps read through.
 * Max halo is budgeted against bar spacing, not a fixed 7px on every bucket — that was the slab.
 */
export function rowStrengthHaloExtraPx(rowSwell: number, opts?: RowStrengthHaloOpts): number {
  const minPx = opts?.minPx ?? ROW_HALO_EXTRA_MIN_PX;
  const maxPx = opts?.maxPx ?? ROW_HALO_EXTRA_MAX_PX;
  const t = Math.max(0, Math.min(1, rowSwell));
  const tHalo = Math.pow(t, ROW_HALO_SWELL_EXP);

  let peakMax = maxPx;
  const barSpacing = opts?.barSpacingPx;
  if (barSpacing != null && Number.isFinite(barSpacing) && barSpacing > 0) {
    peakMax = Math.min(maxPx, Math.max(minPx + 0.4, barSpacing * ROW_HALO_BAR_SPACING_FILL));
  }
  // ...AND against the ROW GAP, which is the axis that actually buries things (2026-08-19).
  // The bar-spacing cap above is horizontal; the halo is a radius and grows in both axes, so
  // vertically it was unbounded and neighbouring rows fused into a slab.
  //
  // The budget covers core + halo TOGETHER: ROW_HALO_ROW_GAP_FILL is the share of the row gap the
  // whole painted band may occupy, and the halo gets whatever the core has not already used. A
  // halo-only cap leaves the core free to take its own BEAD_ROW_FILL share on top, which sums past
  // the gap and reproduces the slab from a different direction.
  const rowGap = opts?.rowGapPx;
  if (rowGap != null && Number.isFinite(rowGap) && rowGap > 0) {
    const bandHalfBudget = (rowGap * ROW_HALO_ROW_GAP_FILL) / 2;
    const core = Number.isFinite(opts?.coreHalfPx) && (opts?.coreHalfPx ?? 0) > 0 ? opts!.coreHalfPx! : 0;
    peakMax = Math.min(peakMax, Math.max(minPx, bandHalfBudget - core));
  }

  return minPx + tHalo * (peakMax - minPx);
}

/** Strength halo opacity — peak = bright bloom, fade = barely-there trace (second swell channel). */
export function rowStrengthHaloAlphaMul(rowSwell: number, floor = 0.06): number {
  const t = Math.max(0, Math.min(1, rowSwell));
  const tA = Math.pow(t, ROW_HALO_SWELL_EXP);
  return floor + tA * (1 - floor);
}

/**
 * TARGET bead half-height (radius) in px.
 *
 * Sized off the per-strike gamma SHARE (`pct`) on a LOG ladder — see beadRadiusForPctShare. `pct`
 * is a share of the ticker's OWN book, so every ticker is treated identically, which is the whole
 * point: the previous absolute-$ ladder was calibrated on SPX and clamped 100% of META/TSLA beads
 * to a single size (measured 2026-08-17).
 *
 * When `rowPeakPct` is set, multiplies by {@link rowSwellMul} so the core bead and its strength
 * halo swell at the row peak and taper when the wall fades (2026-08-19).
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
  let half: number;
  if (Number.isFinite(pct) && pct > 0) {
    half = beadRadiusForPctShare(pct, { floorPx: tuning.halfMin, ceilPx: tuning.halfMax });
  } else {
    // No usable share. Frame-relative is the last resort — with no share there is nothing per-ticker
    // to normalise against, and a bead must still render rather than collapse.
    half = tuning.halfMin + relStrengthT(pct, maxPct) * (tuning.halfMax - tuning.halfMin);
  }
  const rowPeak = opts?.rowPeakPct;
  if (rowPeak != null && rowPeak > 0) {
    // Scale by the row swell, then floor at READABILITY — not at `minRadiusPx`.
    //
    // `minRadiusPx` (1.6) is only the "still technically drawn" bound. BEAD_VISIBLE_MIN_HALF_PX
    // (2.0) is the floor measured against a member's eyes, after NVDA rendered at a 1.1px median
    // radius and was rejected on sight. Flooring a swelled bead at `minRadiusPx` walks the weak end
    // straight back through it: measured at 3m/5.4px on a dense name, pct 2 / 1 / 0.5 all landed at
    // 1.60px — sub-visible, and identical to each other.
    //
    // The floor is a clamp rather than an anchor on purpose. Anchoring (`floor + (half-floor)*swell`)
    // guarantees distinct sizes at every strength, but it also compresses the swell where there IS
    // headroom, and the swell ratio at generous zoom is the whole product goal (a 4x share drop
    // should read as ~2x height). So: full multiplicative swell wherever the bead clears the floor,
    // and a hard visible floor beneath it.
    //
    // Honest consequence, stated because it is a real limit and not a rounding detail: at dense
    // zoom the clamped range is ~1.5px, so the very weak end of a row still PINS to the floor and
    // stops differentiating. Sizes remain non-increasing, never sub-visible — but below roughly the
    // floor/ceiling ratio, the fade has to be carried by a channel other than radius.
    half *= rowSwellMul(pct, rowPeak);
    return Math.max(Math.min(tuning.halfMax, BEAD_VISIBLE_MIN_HALF_PX), tuning.minRadiusPx, half);
  }
  return Math.max(tuning.minRadiusPx, half);
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
  // SUB-linear by default, unlike the SIZE curve — see REL_ALPHA_EXP. `maxPct` is the session-wide
  // king, so a super-linear alpha curve pins every non-king row near the floor for the whole
  // session and its beads all render alike. A profile may still override via `contrastExp`.
  if (!Number.isFinite(pct) || pct <= 0 || !(maxPct > 0)) return tuning.fillMin;
  const t =
    tuning.contrastExp != null
      ? Math.pow(Math.min(1, pct / maxPct), tuning.contrastExp)
      : relAlphaT(pct, maxPct);
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

/**
 * The strongest wall AT EACH BUCKET — the reference a bead's CONTRAST is measured against.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────
 * `kingStrikeByTime` above already establishes what dominated at each moment, and the rail used
 * that knowledge for ONE thing: drawing a crown. Strength itself was scaled against a SESSION-WIDE
 * maximum — the single biggest reading of the whole day — so a wall that was the second-strongest
 * thing on the board at 10:15 and noise by 14:00 rendered at nearly the same brightness in both
 * buckets. A row therefore showed THAT a wall existed and never WHEN it mattered, which is the
 * difference a member identified against the reference product.
 *
 * ── THE TWO CHANNELS NOW SAY DIFFERENT THINGS, DELIBERATELY ──────────────────────────
 *   SIZE stays ABSOLUTE (`beadRadiusForPctShare` on the raw share): a genuinely huge wall looks
 *   huge whenever it occurred, even in a bucket where something else outranked it. That is what
 *   makes comparing two points in TIME honest.
 *
 *   CONTRAST becomes POINT-IN-TIME RELATIVE (this map): how much this wall dominated the board at
 *   that instant. That is what makes comparing two strikes at the SAME moment honest.
 *
 * Read together they carry strictly more than one channel could:
 *   fat + bright  = a huge wall that also dominated the moment
 *   fat + dim     = a huge wall that something else outranked right then
 *   thin + bright = the best of a quiet moment
 *   thin + dim    = noise
 *
 * Falls back to the frame maximum for a bucket with no entry, so a partially-covered frame dims
 * rather than throwing.
 */
export function maxPctByTime(
  trails: ReadonlyArray<{ points: ReadonlyArray<{ time: number; pct: number }> }>
): Map<number, number> {
  const out = new Map<number, number>();
  for (const trail of trails) {
    for (const p of trail.points) {
      if (!Number.isFinite(p.time) || !Number.isFinite(p.pct) || p.pct <= 0) continue;
      const cur = out.get(p.time);
      if (cur == null || p.pct > cur) out.set(p.time, p.pct);
    }
  }
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

/**
 * Fraction of BAR SPACING a bead's diameter may occupy.
 *
 * RAISED 0.85 -> 2.4 (2026-08-18). 0.85 forbade any horizontal overlap, on the assumption that
 * touching beads were the defect. They are not: in the reference product a row IS a near-continuous
 * ribbon of touching dots, and forbidding that shrank beads to ~3px radius at ordinary 3m zoom
 * (~5-7px of room per bar) — trading painted slabs for dots too small and too uniform to read. The
 * member screenshot after that change is the evidence.
 *
 * Kept as a constraint rather than deleted because it still catches the pathological case (a zoom
 * so dense that a bead would span many bars), but it is now deliberately permissive: horizontal
 * overlap is TEXTURE, vertical thickness is the thing that buries candles.
 */
const BEAD_BAR_FILL = 2.4;

/** Fraction of the ROW GAP (price-axis distance to the nearest neighbouring row) a bead's diameter
 *  may occupy. Deliberately about half: this is what keeps rows visibly SEPARATE — the property the
 *  reference product has and the slab render did not — and what stops beads burying the candles. */
const BEAD_ROW_FILL = 0.55;

/**
 * The clamped ceiling may never fall below this.
 *
 * `minRadiusPx` (1.6) is the "still technically drawn" floor, not a readable one. Letting the
 * CEILING collapse toward it destroys the floor-to-ceiling range, and a collapsed range renders
 * every magnitude at one size — which is exactly how the first version of this budget produced a
 * rail of identical faint dots. A bead you cannot see, and a row whose beads cannot differ from
 * each other, both convey nothing; legibility wins over separation.
 */
const BEAD_READABLE_MIN_HALF_PX = 3.2;

/**
 * The clamped FLOOR may never fall below this — the fix for a defect the ceiling rule above could
 * not catch, found by measuring pixels rather than reasoning about the model.
 *
 * MEASURED 2026-08-18, live prod at 1920x1080 (`vector-bead-pixel-audit.cjs`): SPX rendered 160
 * beads with a healthy 3x size ratio, but **NVDA rendered 18 beads at a 1.1px median radius** — sub-
 * 2px specks, which is the member's screenshot exactly. The ceiling was doing its job (clamped to
 * the readable 3.2); the FLOOR was not. On a dense name the row gap is ~4-12px, so the ceiling
 * clamps, and the "preserve the ratio" rule then derives `halfMin = halfMax / ratio` — 3.2 / 3.4 ≈
 * 0.94, raised only to `minRadiusPx` (1.6). Since most walls sit in the weak end of the share
 * distribution, MOST beads drew at that floor. The size channel was preserved in arithmetic and
 * destroyed on screen.
 *
 * So on a crowded axis the range now COMPRESSES rather than sinking: every bead stays at least 2px
 * in radius (4px across, legible on a 1x display) and the size ratio narrows to ~1.6x. That trade is
 * deliberate and it is the right way round — a bead too small to see carries NO information, while a
 * bead whose size differs less still carries its strength through the ALPHA channel, which is the
 * independent, sub-linear channel #2312 split out for exactly this reason. Where a member wants the
 * full size range back on a dense name, the honest lever is fewer rows (the NODES control), not
 * smaller beads.
 */
export const BEAD_VISIBLE_MIN_HALF_PX = 2.0;

/** The floor may never eat more than this share of the clamped ceiling — some size range must
 *  survive, or the rail flattens into the uniform dots this whole budget exists to prevent. */
const BEAD_FLOOR_MAX_SHARE_OF_CEIL = 0.7;

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
  // Never clamp BELOW readability, and never above the profile's own ceiling — a Compare pane whose
  // tuned ceiling is 4.5 must not be inflated to 3.2-or-more logic it never asked for.
  const readable = Math.min(tuning.halfMax, Math.max(floor, BEAD_READABLE_MIN_HALF_PX));
  const halfMax = Math.max(readable, Math.min(...limits));
  if (halfMax >= tuning.halfMax) return tuning; // nothing binds — keep the profile exactly

  // Preserve the profile's dynamic range where the new ceiling allows it — but never by sinking the
  // floor below visibility (see BEAD_VISIBLE_MIN_HALF_PX: that is what drew NVDA as 1.1px specks).
  const ratio = tuning.halfMin > 0 ? tuning.halfMax / tuning.halfMin : 1;
  const ranged = ratio > 1 ? halfMax / ratio : halfMax;
  const visible = Math.min(halfMax * BEAD_FLOOR_MAX_SHARE_OF_CEIL, BEAD_VISIBLE_MIN_HALF_PX);
  const halfMin = Math.min(halfMax, Math.max(floor, ranged, visible));

  // Preserve at least MIN_CLAMPED_HALF_RANGE_PX of vertical dynamic range at dense zoom — a 1px
  // spread passes tests but reads as "every bead the same" on desk (member report 2026-08-19).
  //
  // It has to widen the range from the TOP. The floor is already pinned at
  // BEAD_VISIBLE_MIN_HALF_PX and cannot go lower without reintroducing the sub-visible specks, so
  // the original form — `halfMin = max(floor, VISIBLE, halfMax - RANGE)` — was outranked by the
  // visibility floor and did nothing at exactly the geometry it was written for: measured at
  // 3m/5.4px with 8px row gap, the range stayed 1.20px against a 1.50px target.
  //
  // And it can only widen as far as the SPACING allows. Raising the ceiling past the row-gap limit
  // is how rows stop reading as separate rows, which is the slab this budget exists to prevent. So
  // where the geometry genuinely cannot host the target range, the honest result is a smaller
  // range, not a taller bead — the caller gets the physical truth and `beadRangeMeetsTarget` below
  // lets a test say so out loud instead of asserting a number that silently never binds.
  const rangeCeil = Math.min(tuning.halfMax, Math.max(...limits.slice(1), halfMax));
  const wanted = halfMin + MIN_CLAMPED_HALF_RANGE_PX;
  const widenedMax = Math.max(halfMax, Math.min(rangeCeil, wanted));
  const clampedMin = Math.min(widenedMax, halfMin);

  return { ...tuning, halfMax: widenedMax, halfMin: clampedMin };
}

/**
 * Does this clamped tuning actually carry the intended vertical dynamic range?
 *
 * Exported so a test can assert the property at MEASURED geometry rather than at synthetic tuning
 * values. The guard it checks was shipped in a form that never fired at 3m — the numbers looked
 * right in a unit test built from hand-written tunings and were wrong against the real budget.
 */
export function beadRangeMeetsTarget(
  tuning: BeadRenderTuning,
  targetPx: number = MIN_CLAMPED_HALF_RANGE_PX
): boolean {
  return tuning.halfMax - tuning.halfMin >= targetPx - 1e-9;
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

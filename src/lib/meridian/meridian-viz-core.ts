/**
 * Meridian visualization core — the pure geometry/encoding layer beneath every Meridian
 * analytics primitive. No React, no DOM, no server imports, so every scale, domain and
 * arc in the desk is unit-testable without a browser.
 *
 * The rule this file exists to enforce: a visualization must never SHOW a number it does not
 * HAVE. Every helper takes `number | null` and propagates null rather than coercing — the
 * `Number(null) === 0` trap has produced real defects in this repo, and on a price rail a
 * coerced 0 does not merely mislabel, it drags the whole domain to the origin and squashes
 * every real marker into a single pixel at the right edge.
 */

/**
 * Finite-number guard. `null`, `undefined`, `""`, NaN and Infinity are all "no value".
 *
 * The explicit null/undefined/empty-string rejection is load-bearing, not defensive noise:
 * `Number(null)`, `Number(undefined ?? "")` and `Number("")` all produce `0`, which
 * `Number.isFinite` then happily accepts. Handing that 0 to a price domain does not mislabel a
 * single marker — it drags the floor to the origin and squashes every real level into the
 * rail's right edge. This function's own test suite caught this exact regression in this exact
 * line, which is the best argument for keeping the test.
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null; // Number(true) === 1 — a flag is not a measurement
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to `dp` decimals, returning a clean float. Guards the 100*(1+10/100) === 110.00000000000001
 *  class of artifact from reaching a rendered axis label or an equality check. */
export function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  // `+ 0` collapses -0 to 0. Negative zero is not equal to zero under Object.is (so it fails
  // strict assertions) and stringifies as "-0" into transform/path output.
  return r + 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Price domains + rails ────────────────────────────────────────────────────────────

export type Domain = { min: number; max: number };

/**
 * Smallest domain covering every supplied value, with symmetric padding.
 *
 * Every marker that will be DRAWN must be passed in. Building a domain from the expected-move
 * band alone and then plotting a call wall outside it does not produce an off-screen marker —
 * `pctAlong` clamps, so the wall silently pins to the rail's end and reads as "the wall is
 * exactly at the boundary", which is a specific false claim rather than a missing one.
 *
 * Returns null when fewer than two distinct finite values exist: a rail needs an extent, and a
 * fabricated one (value ± 1%) would invent a scale the data never supported.
 */
export function priceDomain(values: Array<number | null | undefined>, padPct = 0.06): Domain | null {
  const finite = values.map(num).filter((v): v is number => v !== null);
  if (finite.length === 0) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    // A single distinct value still deserves a rail — centre it in a small symmetric window
    // derived from its own magnitude, and let callers decide whether one point is worth drawing.
    const eps = Math.abs(min) * 0.01 || 1;
    min -= eps;
    max += eps;
  }
  const pad = (max - min) * padPct;
  return { min: min - pad, max: max + pad };
}

/** Position of `value` along `domain` as 0..1 (0 = min, 1 = max). Null in, null out. */
export function pctAlong(value: number | null | undefined, domain: Domain | null): number | null {
  const v = num(value);
  if (v === null || !domain) return null;
  const span = domain.max - domain.min;
  if (!(span > 0)) return null;
  return clamp((v - domain.min) / span, 0, 1);
}

/** Same as pctAlong but expressed as a CSS percentage string, or null. */
export function pctAlongCss(value: number | null | undefined, domain: Domain | null): string | null {
  const p = pctAlong(value, domain);
  return p === null ? null : `${(p * 100).toFixed(3)}%`;
}

// ── Expected move ────────────────────────────────────────────────────────────────────

export type MoveBand = { spot: number; down: number; up: number; pct: number | null };

/**
 * Normalize an expected-move band. Accepts the served `{spot, up, down}` shape, and
 * reconstructs the bounds from a percentage when only that is present.
 *
 * Guards the inverted case (`up < down`) rather than trusting field names: a flipped band
 * renders as a zero-or-negative-width range that silently disappears, and the upstream is a
 * third-party feed we do not control.
 */
export function normalizeMoveBand(
  band: { spot?: number | null; up?: number | null; down?: number | null } | null | undefined,
  movePct?: number | null
): MoveBand | null {
  const spot = num(band?.spot);
  if (spot === null || spot <= 0) return null;
  const pct = num(movePct);
  let up = num(band?.up);
  let down = num(band?.down);
  if ((up === null || down === null) && pct !== null) {
    // Rounded: the raw product lands on 110.00000000000001, which reaches axis labels verbatim.
    up = round(spot * (1 + pct / 100), 6);
    down = round(spot * (1 - pct / 100), 6);
  }
  if (up === null || down === null) return null;
  if (up < down) [up, down] = [down, up];
  return {
    spot,
    up,
    down,
    pct: pct ?? Number((((up - down) / 2 / spot) * 100).toFixed(2)),
  };
}

// ── Intelligence halo ────────────────────────────────────────────────────────────────

export type SignalLike = { lean: "bullish" | "bearish" | "neutral"; weight?: number | null; score?: number | null };

export type HaloSegment = {
  lean: "bullish" | "bearish" | "neutral";
  /** Fraction of the ring this segment occupies (0..1). Segments sum to 1. */
  fraction: number;
  weight: number;
};

export type HaloRead = {
  segments: HaloSegment[];
  bullWeight: number;
  bearWeight: number;
  neutralWeight: number;
  totalWeight: number;
  /**
   * 0..1 — how much the contributing signals AGREE. 1 = every weighted signal leans the same
   * way; 0 = bull and bear weight are perfectly balanced. This is the number the halo exists to
   * communicate: a "BULLISH 68" built from ten signals that all lean bullish is a completely
   * different setup from one built from six bullish and four bearish, and a single score cannot
   * distinguish them. Neutral weight dilutes conviction without taking a side.
   */
  agreement: number;
  dominant: "bullish" | "bearish" | "neutral";
};

/**
 * Reduce weighted signals to halo geometry + an agreement measure.
 *
 * Weights are treated as MAGNITUDES: a signal's `lean` carries its direction, so a negative
 * weight would double-count the sign and shrink the ring. Signals with no usable weight fall
 * back to 1 so a present-but-unweighted signal still occupies the ring — dropping it would
 * quietly under-represent the evidence the verdict was actually built from.
 */
export function haloFromSignals(signals: readonly SignalLike[] | null | undefined): HaloRead | null {
  const rows = (signals ?? []).map((s) => ({
    lean: s.lean,
    weight: Math.abs(num(s.weight) ?? 1) || 1,
  }));
  if (rows.length === 0) return null;

  const total = rows.reduce((a, r) => a + r.weight, 0);
  if (!(total > 0)) return null;

  const bull = rows.filter((r) => r.lean === "bullish").reduce((a, r) => a + r.weight, 0);
  const bear = rows.filter((r) => r.lean === "bearish").reduce((a, r) => a + r.weight, 0);
  const neutral = total - bull - bear;

  const directional = bull + bear;
  // With no directional weight at all, "agreement" is undefined rather than perfect — an
  // all-neutral book agrees on nothing, it simply says nothing.
  const agreement = directional > 0 ? Math.abs(bull - bear) / directional : 0;

  const dominant: HaloRead["dominant"] =
    bull > bear && bull >= neutral ? "bullish" : bear > bull && bear >= neutral ? "bearish" : "neutral";

  return {
    segments: rows.map((r) => ({ lean: r.lean, fraction: r.weight / total, weight: r.weight })),
    bullWeight: bull,
    bearWeight: bear,
    neutralWeight: neutral,
    totalWeight: total,
    agreement: Number(agreement.toFixed(4)),
    dominant,
  };
}

/** SVG arc path on a circle centred at (cx,cy). Angles in degrees, 0 = 12 o'clock, clockwise. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const sweep = endDeg - startDeg;
  // A full ring cannot be drawn as one arc (start === end is a degenerate point), so cap just
  // under 360 — the seam is sub-pixel at any real radius.
  const capped = clamp(sweep, -359.999, 359.999);
  const toXY = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [x0, y0] = toXY(startDeg);
  const [x1, y1] = toXY(startDeg + capped);
  const largeArc = Math.abs(capped) > 180 ? 1 : 0;
  const sweepFlag = capped >= 0 ? 1 : 0;
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

// ── Beat history ─────────────────────────────────────────────────────────────────────

export type PrintLike = {
  report_date?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  surprise_pct?: number | null;
  beat?: boolean | null;
  session_change_pct?: number | null;
  reaction_basis?: string | null;
};

export type BeatPoint = {
  date: string | null;
  surprisePct: number | null;
  beat: boolean | null;
  reactionPct: number | null;
  /** True when the reaction was measured on an ASSUMED session (timing unknown) — the UI must
   *  mark these; see meridian-reaction-core. */
  reactionAssumed: boolean;
  /** Bar magnitude 0..1, scaled against the largest |surprise| in the same series so one
   *  outlier quarter cannot flatten the rest into invisible stubs. */
  magnitude: number;
};

export function beatSeries(prints: readonly PrintLike[] | null | undefined): BeatPoint[] {
  const rows = (prints ?? []).filter(Boolean);
  const surprises = rows.map((p) => num(p.surprise_pct)).filter((v): v is number => v !== null);
  const peak = surprises.length ? Math.max(...surprises.map(Math.abs)) : 0;
  return rows.map((p) => {
    const s = num(p.surprise_pct);
    return {
      date: p.report_date ?? null,
      surprisePct: s,
      // Prefer the explicit flag; fall back to the surprise sign, but never invent a verdict
      // from a missing number.
      beat: p.beat ?? (s === null ? null : s >= 0),
      reactionPct: num(p.session_change_pct),
      reactionAssumed: p.reaction_basis === "assumed_report_session",
      magnitude: s === null || peak <= 0 ? 0 : clamp(Math.abs(s) / peak, 0, 1),
    };
  });
}

/** Beat/miss tally over the graded subset only — ungraded prints must not count as misses. */
export function beatTally(points: readonly BeatPoint[]): { beats: number; graded: number } {
  const graded = points.filter((p) => p.beat !== null);
  return { beats: graded.filter((p) => p.beat).length, graded: graded.length };
}

// ── Analyst revision momentum ────────────────────────────────────────────────────────

export type RevisionMomentum = {
  raised: number;
  lowered: number;
  initiated: number;
  total: number;
  /** -1..1 — net directional tilt of revisions. Initiations are counted in the total but not
   *  as a direction: starting coverage is not an opinion change. */
  tilt: number;
  skew: "bullish" | "bearish" | "neutral";
};

export function revisionMomentum(
  skew: { raised_count?: number | null; lowered_count?: number | null; initiated_count?: number | null; skew?: string | null } | null | undefined
): RevisionMomentum | null {
  if (!skew) return null;
  const raised = num(skew.raised_count) ?? 0;
  const lowered = num(skew.lowered_count) ?? 0;
  const initiated = num(skew.initiated_count) ?? 0;
  const total = raised + lowered + initiated;
  if (total <= 0) return null;
  const directional = raised + lowered;
  const tilt = directional > 0 ? (raised - lowered) / directional : 0;
  const declared = skew.skew;
  const derived: RevisionMomentum["skew"] = tilt > 0.15 ? "bullish" : tilt < -0.15 ? "bearish" : "neutral";
  return {
    raised,
    lowered,
    initiated,
    total,
    tilt: Number(tilt.toFixed(4)),
    // Trust the server's own label when it supplied one — it is the value the rest of the
    // product reasons about, and deriving a second opinion here would let the chip disagree
    // with the sentence beside it.
    skew: declared === "bullish" || declared === "bearish" || declared === "neutral" ? declared : derived,
  };
}

// ── Price target rail ────────────────────────────────────────────────────────────────

export type TargetRail = {
  low: number;
  high: number;
  consensus: number;
  spot: number | null;
  upsidePct: number | null;
  targets: Array<{ value: number; firm: string | null; action: string | null }>;
};

export function targetRail(
  rows: ReadonlyArray<{ price_target?: number | null; firm?: string | null; action?: string | null }> | null | undefined,
  spot?: number | null
): TargetRail | null {
  const targets = (rows ?? [])
    .map((r) => ({ value: num(r.price_target), firm: r.firm ?? null, action: r.action ?? null }))
    .filter((t): t is { value: number; firm: string | null; action: string | null } => t.value !== null && t.value > 0);
  if (targets.length === 0) return null;
  const values = targets.map((t) => t.value).sort((a, b) => a - b);
  const low = values[0]!;
  const high = values[values.length - 1]!;
  // MEDIAN, not mean: a single outlier target (a $19 in a $12-15 cluster) drags a mean off the
  // cluster the rail is meant to show, and "consensus" that sits where no analyst is defeats
  // the point of drawing the distribution.
  const mid = Math.floor(values.length / 2);
  const consensus = values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  const s = num(spot);
  return {
    low,
    high,
    consensus,
    spot: s,
    upsidePct: s !== null && s > 0 ? Number((((consensus - s) / s) * 100).toFixed(1)) : null,
    targets,
  };
}

// ── Gamma / dealer structure ladder ──────────────────────────────────────────────────

export type LadderLevel = {
  key: "call_wall" | "gamma_flip" | "spot" | "king_node" | "put_wall" | "max_pain";
  label: string;
  value: number;
  /** Distance from spot as a signed %, or null when spot is unknown. */
  distPct: number | null;
};

/**
 * Order dealer-structure levels by PRICE, top (highest) to bottom.
 *
 * Spatial ordering is the entire point: a list that prints call wall / flip / spot / put wall in
 * a fixed narrative order lies whenever the book is arranged differently — and an inverted book
 * (spot above the call wall, flip below the put wall) is exactly the regime a trader most needs
 * to see. Levels are placed where the numbers put them, never where the template expects.
 */
export function structureLadder(
  thermal: {
    spot?: number | null;
    call_wall?: number | null;
    put_wall?: number | null;
    flip?: number | null;
    gex_king_strike?: number | null;
    max_pain?: number | null;
  } | null | undefined
): LadderLevel[] {
  if (!thermal) return [];
  const spot = num(thermal.spot);
  const defs: Array<[LadderLevel["key"], string, number | null]> = [
    ["call_wall", "Call wall", num(thermal.call_wall)],
    ["gamma_flip", "Gamma flip", num(thermal.flip)],
    ["spot", "Spot", spot],
    ["king_node", "King node", num(thermal.gex_king_strike)],
    ["put_wall", "Put wall", num(thermal.put_wall)],
    ["max_pain", "Max pain", num(thermal.max_pain)],
  ];
  return defs
    .filter((d): d is [LadderLevel["key"], string, number] => d[2] !== null)
    .map(([key, label, value]) => ({
      key,
      label,
      value,
      distPct: spot !== null && spot > 0 ? Number((((value - spot) / spot) * 100).toFixed(2)) : null,
    }))
    .sort((a, b) => b.value - a.value);
}

// ── Dark pool tape ───────────────────────────────────────────────────────────────────

export type TapePrint = {
  premium: number;
  label: string | null;
  strike: number | null;
  side: string | null;
  at: string | null;
  /** 0..1 area-proportional magnitude — see below. */
  magnitude: number;
};

/**
 * Dark-pool prints scaled for display, largest-first.
 *
 * Magnitude is the SQUARE ROOT of the premium ratio because these render as 2-D marks. Human
 * size judgement tracks area, so mapping premium linearly to a diameter squares the perceived
 * difference — a print 4x larger looks 16x larger. Rooting the ratio makes area proportional to
 * premium, which is what "large prints should physically appear more significant" actually
 * requires.
 */
export function darkPoolTape(
  prints: ReadonlyArray<{ premium?: number | null; premium_label?: string | null; strike?: number | null; side?: string | null; executed_at?: string | null }> | null | undefined
): TapePrint[] {
  const rows = (prints ?? [])
    .map((p) => ({
      premium: num(p.premium),
      label: p.premium_label ?? null,
      strike: num(p.strike),
      side: p.side ?? null,
      at: p.executed_at ?? null,
    }))
    .filter((p): p is TapePrint & { premium: number } => p.premium !== null && p.premium > 0) as Array<
    Omit<TapePrint, "magnitude"> & { premium: number }
  >;
  if (rows.length === 0) return [];
  const peak = Math.max(...rows.map((r) => r.premium));
  return rows
    .map((r) => ({ ...r, magnitude: peak > 0 ? clamp(Math.sqrt(r.premium / peak), 0, 1) : 0 }))
    .sort((a, b) => b.premium - a.premium);
}

// ── Countdown ────────────────────────────────────────────────────────────────────────

export type Countdown = { days: number; hours: number; minutes: number; totalMs: number; past: boolean };

/** Time to an event. Negative spans report `past: true` rather than clamping to zero, so a
 *  printed event can say so instead of freezing at 00D:00H:00M as though it were imminent. */
export function countdownTo(targetIso: string | null | undefined, nowMs: number): Countdown | null {
  if (!targetIso) return null;
  const t = Date.parse(targetIso);
  if (!Number.isFinite(t)) return null;
  const diff = t - nowMs;
  const abs = Math.abs(diff);
  return {
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    totalMs: diff,
    past: diff < 0,
  };
}

// ── Sparkline ────────────────────────────────────────────────────────────────────────

/**
 * Polyline points for a sparkline in a `width` x `height` box. Y is inverted (SVG origin is
 * top-left). Returns null for fewer than two finite points — a one-point "trend" is not one.
 */
export function sparklinePoints(
  values: Array<number | null | undefined>,
  width: number,
  height: number,
  pad = 1
): string | null {
  const finite = values.map(num);
  const present = finite.filter((v): v is number => v !== null);
  if (present.length < 2) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;
  const step = innerW / (finite.length - 1);
  const pts: string[] = [];
  finite.forEach((v, i) => {
    if (v === null) return; // gaps break the line rather than interpolating a value we lack
    const y = span > 0 ? pad + innerH - ((v - min) / span) * innerH : pad + innerH / 2;
    pts.push(`${(pad + i * step).toFixed(2)},${y.toFixed(2)}`);
  });
  return pts.length >= 2 ? pts.join(" ") : null;
}

// ── Live signal chips ────────────────────────────────────────────────────────────────

export type LiveSignal =
  | "accelerating"
  | "deteriorating"
  | "anomaly"
  | "top_performer"
  | "newly_changed"
  | "approaching_threshold"
  | "rank_improving"
  | "rank_falling";

export const LIVE_SIGNAL_GLYPH: Record<LiveSignal, string> = {
  accelerating: "↑",
  deteriorating: "↓",
  anomaly: "⚡",
  top_performer: "◎",
  newly_changed: "◉",
  approaching_threshold: "△",
  rank_improving: "↗",
  rank_falling: "↘",
};

export const LIVE_SIGNAL_LABEL: Record<LiveSignal, string> = {
  accelerating: "accelerating",
  deteriorating: "deteriorating",
  anomaly: "anomaly",
  top_performer: "top performer",
  newly_changed: "newly changed",
  approaching_threshold: "approaching threshold",
  rank_improving: "rank improving",
  rank_falling: "rank falling",
};

/**
 * Derive a momentum signal from a current value and its prior.
 *
 * Returns null unless BOTH values exist and the move clears `minPct`. Firing on every
 * micro-move would make the chip decorative — it has to mean "this changed enough to look at",
 * or a trader learns to ignore it, which is worse than not showing it.
 */
export function momentumSignal(
  current: number | null | undefined,
  prior: number | null | undefined,
  minPct = 5
): LiveSignal | null {
  const c = num(current);
  const p = num(prior);
  if (c === null || p === null || p === 0) return null;
  const deltaPct = ((c - p) / Math.abs(p)) * 100;
  if (Math.abs(deltaPct) < minPct) return null;
  return deltaPct > 0 ? "accelerating" : "deteriorating";
}

/** Anomaly when |value| exceeds `sigma` standard deviations of the supplied history. */
export function anomalySignal(
  value: number | null | undefined,
  history: Array<number | null | undefined>,
  sigma = 2
): LiveSignal | null {
  const v = num(value);
  const hist = history.map(num).filter((h): h is number => h !== null);
  // Two points have a standard deviation but not a meaningful one; demand a real sample.
  if (v === null || hist.length < 4) return null;
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return Math.abs(v - mean) >= sigma * sd ? "anomaly" : null;
}

// ── Signal dimension rollup ──────────────────────────────────────────────────────────

/**
 * The report serves up to 11 PILLARS. Eleven rings is not a decision surface — it is the same
 * wall of detail the redesign exists to remove, drawn as circles. They roll up into five
 * DIMENSIONS a trader actually reasons in, each of which stays clickable down to the pillars
 * that produced it.
 *
 * `fundamentals` deliberately joins HISTORY rather than earning a sixth ring: it answers "what
 * does this company look like coming in", which is the same question as the track record, and a
 * lone ring backed by one pillar reads as more independent evidence than it is.
 */
export const PILLAR_DIMENSION: Record<string, MeridianDimension> = {
  flow: "FLOW",
  dark_pool: "FLOW",
  thermal: "STRUCTURE",
  vector: "STRUCTURE",
  analyst: "SENTIMENT",
  news: "CATALYST",
  insider: "CATALYST",
  history: "HISTORY",
  surprise: "HISTORY",
  yoy: "HISTORY",
  fundamentals: "HISTORY",
};

export type MeridianDimension = "FLOW" | "STRUCTURE" | "SENTIMENT" | "CATALYST" | "HISTORY";

export const DIMENSION_ORDER: MeridianDimension[] = ["FLOW", "STRUCTURE", "SENTIMENT", "CATALYST", "HISTORY"];

export type DimensionRead = {
  dimension: MeridianDimension;
  lean: "bullish" | "bearish" | "neutral";
  /** 0..100 — weighted conviction. Not a score out of the whole book; a per-dimension read. */
  intensity: number;
  /** Signed weighted score, sign carries direction. */
  net: number;
  pillars: string[];
  contributing: number;
};

/**
 * Roll pillar signals into dimension reads.
 *
 * Intensity is |net| over TOTAL weight in that dimension, so two pillars that disagree produce
 * a LOW intensity rather than cancelling into a confident-looking zero — "flow says nothing"
 * and "flow is fighting itself" must not render identically. A dimension with no contributing
 * pillars is omitted entirely rather than drawn as an empty ring.
 */
export function dimensionRollup(
  signals: ReadonlyArray<{ pillar?: string | null; lean?: string | null; weight?: number | null; score?: number | null }> | null | undefined
): DimensionRead[] {
  const buckets = new Map<MeridianDimension, { net: number; total: number; pillars: string[] }>();
  for (const s of signals ?? []) {
    const dim = PILLAR_DIMENSION[String(s.pillar ?? "")];
    if (!dim) continue;
    const weight = Math.abs(num(s.weight) ?? 1) || 1;
    const dir = s.lean === "bullish" ? 1 : s.lean === "bearish" ? -1 : 0;
    const b = buckets.get(dim) ?? { net: 0, total: 0, pillars: [] };
    b.net += dir * weight;
    b.total += weight;
    if (s.pillar) b.pillars.push(String(s.pillar));
    buckets.set(dim, b);
  }
  return DIMENSION_ORDER.filter((d) => buckets.has(d)).map((dimension) => {
    const b = buckets.get(dimension)!;
    const intensity = b.total > 0 ? Math.round((Math.abs(b.net) / b.total) * 100) : 0;
    return {
      dimension,
      lean: b.net > 0 ? "bullish" : b.net < 0 ? "bearish" : "neutral",
      intensity,
      net: round(b.net, 3),
      pillars: b.pillars,
      contributing: b.pillars.length,
    };
  });
}

// ── ET wall-clock → UTC instant ──────────────────────────────────────────────────────

/**
 * Compose an ET calendar date + wall-clock time into a UTC ISO instant.
 *
 * Needed because the earnings feed reports "2026-08-19" + "16:15:00" as ET WALL CLOCK, while a
 * countdown needs an absolute instant. A hardcoded `-05:00` is wrong for ~8 months of the year
 * and a hardcoded `-04:00` for the other ~4 — either way the countdown is an hour off across
 * half the calendar, which on an event clock reads as a real scheduling error.
 *
 * Method: guess the instant as if the wall clock were UTC, ask Intl what ET time that instant
 * actually is, and correct by the difference. Repeated twice so an instant that lands inside a
 * DST transition (where the first correction crosses the boundary) still converges.
 */
export function etWallClockToIso(ymd: string | null | undefined, hhmmss?: string | null): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(hhmmss ?? "").trim());
  const hh = tm ? Number(tm[1]) : 0;
  const mm = tm ? Number(tm[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;

  const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
  // The TARGET wall clock, held fixed. Drift must be measured against this, not against the
  // moving `guess`: comparing to `guess` makes the second iteration re-apply a correction the
  // first one already made, landing 8h off in EDT. (Caught by the DST tests, not by reading.)
  const targetAsUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let guess = targetAsUtc;

  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    // `hour: "2-digit"` with hour12:false yields 24 for midnight in some ICU versions.
    const asUtcOfEtReading = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    const drift = asUtcOfEtReading - targetAsUtc;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess).toISOString();
}

// ── Label collision resolution ───────────────────────────────────────────────────────

/**
 * Nudge positions apart so spatially-placed labels stay readable, preserving ORDER.
 *
 * A ladder places rows at their true price, which is the entire point — but two levels a few
 * cents apart land on the same pixel and print on top of each other. Measured on a real WMT-
 * shaped book: king node 780 and max pain 775 resolved 7px apart in a 132px ladder, with rows
 * ~14px tall, so the two labels were unreadable.
 *
 * The fix must NOT re-sort: a resolver that reorders would destroy the spatial truth the
 * component exists to show. This does a forward sweep (push each item at least `minGap` past
 * its predecessor), then a backward sweep to pull the stack back inside [0,1] if it overflowed.
 * The VALUE text stays exact — only the drawn position moves, and only as far as it must.
 *
 * When the items cannot all fit at `minGap`, they distribute evenly across the full span:
 * squashing is honest (they really are that close), silent overlap is not.
 */
export function resolveCollisions(positions: number[], minGap: number): number[] {
  const n = positions.length;
  if (n === 0) return [];
  if (n === 1) return [clamp(positions[0]!, 0, 1)];

  // Not enough room for everyone — spread evenly rather than pile up at an edge.
  if (minGap * (n - 1) >= 1) {
    const step = 1 / (n - 1);
    const asc = positions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const out = new Array<number>(n);
    asc.forEach((item, rank) => {
      out[item.i] = rank * step;
    });
    return out;
  }

  const asc = positions.map((p, i) => ({ p: clamp(p, 0, 1), i })).sort((a, b) => a.p - b.p);
  // Forward: enforce the gap going up.
  for (let k = 1; k < n; k += 1) {
    const prev = asc[k - 1]!.p;
    if (asc[k]!.p - prev < minGap) asc[k]!.p = prev + minGap;
  }
  // Backward: if the stack pushed past 1, pull it down without breaking the gap.
  if (asc[n - 1]!.p > 1) {
    asc[n - 1]!.p = 1;
    for (let k = n - 2; k >= 0; k -= 1) {
      const next = asc[k + 1]!.p;
      if (next - asc[k]!.p < minGap) asc[k]!.p = next - minGap;
    }
  }
  const out = new Array<number>(n);
  for (const item of asc) out[item.i] = clamp(item.p, 0, 1);
  return out;
}

// ── Estimate trajectory ──────────────────────────────────────────────────────────────

export type TrajectoryPoint = {
  period: string;
  estimate: number | null;
  actual: number | null;
  /** Signed surprise %, or null when either side is missing. */
  surprisePct: number | null;
  /** 0..1 bar heights against the series' own extent. Null when the value is missing. */
  estHeight: number | null;
  actHeight: number | null;
  /** True for a period with an estimate but no actual — the upcoming print. */
  forward: boolean;
};

/**
 * Estimate-vs-actual trajectory, oldest → newest, with forward periods on the end.
 *
 * Heights share ONE scale across estimates and actuals. Scaling each series to its own max
 * would make a miss look like a beat: the two bars would reach the same height whenever the
 * actual is the series' own maximum, destroying the comparison the chart exists to make.
 *
 * The scale runs from 0 (or the series minimum when negative — loss-making names are common in
 * this feed) so bar LENGTH stays proportional to magnitude rather than to distance above an
 * arbitrary floor.
 */
export function estimateTrajectory(
  rows: ReadonlyArray<{ period?: string | null; estimate?: number | null; actual?: number | null }> | null | undefined
): TrajectoryPoint[] {
  const pts = (rows ?? []).map((r) => ({
    period: String(r.period ?? "—"),
    estimate: num(r.estimate),
    actual: num(r.actual),
  }));
  if (pts.length === 0) return [];

  const all = pts.flatMap((p) => [p.estimate, p.actual]).filter((v): v is number => v !== null);
  if (all.length === 0) {
    return pts.map((p) => ({ ...p, surprisePct: null, estHeight: null, actHeight: null, forward: p.actual === null }));
  }
  // Anchor to zero ONLY when the series crosses it, so the sign change stays visible. For a
  // series entirely on one side of zero — routine here, since loss-making names report negative
  // EPS every quarter — a 0-anchored scale crushes every bar into the first few percent of the
  // track: measured on a real pair (-0.17 est, -0.13 act) the estimate outline came out 6% wide
  // and was invisible. Range-relative scaling keeps the est-vs-act comparison, which is the
  // question the panel exists to answer, legible.
  const rawLo = Math.min(...all);
  const rawHi = Math.max(...all);
  const crossesZero = rawLo < 0 && rawHi > 0;
  const lo = crossesZero ? Math.min(0, rawLo) : rawLo;
  const hi = crossesZero ? Math.max(0, rawHi) : rawHi;
  const span = hi - lo;
  const height = (v: number | null): number | null =>
    v === null ? null : span > 0 ? round(clamp((v - lo) / span, 0, 1), 4) : 0;

  return pts.map((p) => ({
    ...p,
    // Surprise is undefined against a zero estimate — a "percent above nothing" is not a number.
    surprisePct:
      p.estimate !== null && p.actual !== null && p.estimate !== 0
        ? round(((p.actual - p.estimate) / Math.abs(p.estimate)) * 100, 2)
        : null,
    estHeight: height(p.estimate),
    actHeight: height(p.actual),
    forward: p.actual === null && p.estimate !== null,
  }));
}

/** Dispersion of street estimates for one period — the disagreement the consensus hides. */
export function estimateDispersion(values: Array<number | null | undefined>): {
  low: number;
  high: number;
  median: number;
  spreadPct: number | null;
  n: number;
} | null {
  const v = values.map(num).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  const low = v[0]!;
  const high = v[v.length - 1]!;
  return {
    low,
    high,
    median,
    // Spread relative to |median| — an absolute spread is meaningless across names whose EPS
    // differ by orders of magnitude. Undefined at a zero median rather than Infinity.
    spreadPct: median !== 0 ? round(((high - low) / Math.abs(median)) * 100, 1) : null,
    n: v.length,
  };
}

// ── Strike exposure profile ──────────────────────────────────────────────────────────

export type StrikeBar = {
  strike: number;
  pct: number;
  /** 0..1 bar length against the largest |pct| in the set. */
  magnitude: number;
  side: "call" | "put" | "flat";
  /** True for the strike nearest spot — the reader's anchor in the ladder. */
  atSpot: boolean;
};

/**
 * Per-strike dealer exposure, ordered HIGH strike → LOW so the profile reads like a price
 * axis rather than a ranked list. `pct_of_total` is signed in the feed: positive = dealer
 * long gamma (resistance), negative = short (support).
 *
 * Magnitude scales against the largest ABSOLUTE percentage, not the largest positive one —
 * otherwise a book dominated by put-side exposure renders every bar as a stub.
 */
export function strikeProfile(
  rows: ReadonlyArray<{ strike?: number | null; pct_of_total?: number | null }> | null | undefined,
  spot?: number | null
): StrikeBar[] {
  const parsed = (rows ?? [])
    .map((r) => ({ strike: num(r.strike), pct: num(r.pct_of_total) }))
    .filter((r): r is { strike: number; pct: number } => r.strike !== null && r.pct !== null);
  if (parsed.length === 0) return [];
  const peak = Math.max(...parsed.map((r) => Math.abs(r.pct)));
  const s = num(spot);
  // Nearest strike to spot, computed once — comparing inside the map would be O(n^2) and,
  // more importantly, could mark several strikes when two tie.
  let nearest: number | null = null;
  if (s !== null) {
    nearest = parsed.reduce((best, r) => (Math.abs(r.strike - s) < Math.abs(best - s) ? r.strike : best), parsed[0]!.strike);
  }
  return parsed
    .map((r) => ({
      strike: r.strike,
      pct: r.pct,
      magnitude: peak > 0 ? round(clamp(Math.abs(r.pct) / peak, 0, 1), 4) : 0,
      side: (r.pct > 0 ? "call" : r.pct < 0 ? "put" : "flat") as StrikeBar["side"],
      atSpot: nearest !== null && r.strike === nearest,
    }))
    .sort((a, b) => b.strike - a.strike);
}

// ── Implied vs realized ──────────────────────────────────────────────────────────────

export type ImpliedVsRealized = {
  impliedPct: number;
  realized: number[];
  avgRealized: number;
  medianRealized: number;
  /** implied / median realized. >1 = options pricing MORE than this name historically delivers. */
  ratio: number | null;
  verdict: "rich" | "cheap" | "fair";
  /** Fraction of past prints whose move exceeded the current implied move. */
  exceedRate: number;
  n: number;
};

/**
 * Compare the market's implied move against what this name has ACTUALLY delivered.
 *
 * This is the sharpest question on the earnings desk — is the options market pricing a bigger
 * move than this stock historically makes — and it was unanswerable until the reaction data was
 * recovered. Uses ABSOLUTE moves: direction is a separate question, and mixing signs would
 * average a +8% and a -8% quarter into "0% typical move", which is the opposite of the truth.
 *
 * Median leads the verdict (the mean is dragged by a single gap quarter), with a deliberately
 * wide fair band — an 8-quarter sample cannot support a finer call than "clearly rich",
 * "clearly cheap", or "too close to say".
 */
export function impliedVsRealized(
  impliedPct: number | null | undefined,
  moves: Array<number | null | undefined>,
  fairBand = 0.25
): ImpliedVsRealized | null {
  const implied = num(impliedPct);
  const realized = moves.map(num).filter((v): v is number => v !== null).map(Math.abs);
  if (implied === null || implied <= 0 || realized.length === 0) return null;
  const sorted = [...realized].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const avg = realized.reduce((a, b) => a + b, 0) / realized.length;
  const ratio = median > 0 ? round(implied / median, 3) : null;
  return {
    impliedPct: implied,
    realized,
    avgRealized: round(avg, 2),
    medianRealized: round(median, 2),
    ratio,
    verdict: ratio === null ? "fair" : ratio > 1 + fairBand ? "rich" : ratio < 1 - fairBand ? "cheap" : "fair",
    exceedRate: round(realized.filter((m) => m > implied).length / realized.length, 3),
    n: realized.length,
  };
}

/* ── Horizontal rail label placement ────────────────────────────────────────────────── */

export type RailLabelSlot = {
  /** 0..1 position along the track where the label is CENTRED (may differ from the tick). */
  pos: number;
  /** 0 = nearest the track, higher = stacked further away. */
  tier: number;
};

/**
 * Place labels along a horizontal rail without overlapping them.
 *
 * Different problem from `resolveCollisions`, which nudges along ONE axis assuming uniform row
 * heights. Rail labels are text of very different widths ("call wall" vs "king"), and observed
 * live on the Meridian positioning rail they printed straight through each other at the right
 * edge — "call wall" and "king" merged into one garbled string.
 *
 * Two mechanisms, in this order:
 *   1. CLAMP so a label near either end stays inside the track. An edge marker centred on its
 *      tick hangs half its width off the rail, which is the other half of what was observed.
 *   2. TIER — a label that still cannot fit beside its neighbour moves to the next row out,
 *      rather than being pushed along the axis. Pushing would decouple the label from its tick
 *      by an arbitrary distance; a second row keeps every label near the level it names.
 * Only when every tier is full does it fall back to nudging, which is the honest last resort:
 * the levels really are that close.
 *
 * The TICK never moves — only the label. Spatial truth stays on the track.
 */
export function layoutRailLabels(
  labels: ReadonlyArray<{ pos: number; widthFrac: number }>,
  maxTiers = 2,
  gapFrac = 0.012
): RailLabelSlot[] {
  const n = labels.length;
  if (n === 0) return [];
  const order = labels.map((l, i) => ({ i, ...l })).sort((a, b) => a.pos - b.pos);
  // Right edge occupied so far, per tier.
  const filled = new Array<number>(maxTiers).fill(-Infinity);
  const out = new Array<RailLabelSlot>(n);

  for (const item of order) {
    const half = Math.min(item.widthFrac, 1) / 2;
    const centred = clamp(item.pos, half, 1 - half);
    let tier = filled.findIndex((right) => centred - half >= right + gapFrac);
    let pos = centred;
    if (tier === -1) {
      // Every tier is occupied at this x — take the emptiest and nudge just clear of it.
      tier = filled.indexOf(Math.min(...filled));
      pos = clamp(filled[tier]! + gapFrac + half, half, 1 - half);
    }
    filled[tier] = pos + half;
    out[item.i] = { pos: round(pos, 5), tier };
  }
  return out;
}

/* ── Refresh cadence ──────────────────────────────────────────────────────────────── */

/**
 * How often to refetch an event's detail, from how close its print is.
 *
 * The old cadence was flat: 15s if the name had already printed, 30s if any name that week had,
 * 60s otherwise. So an event ten days out was polled almost as hard as one reporting in
 * minutes, and one reporting in minutes was polled no harder than one next week. Both halves of
 * that are wrong, and they are wrong in opposite directions.
 *
 * Scaling by proximity spends the request budget where it changes a decision. It also answers
 * "can we call the APIs more aggressively?" honestly: yes — aggressively where it matters, and
 * LESS aggressively where nothing moves, which is what makes the aggression affordable.
 *
 * A name that has already printed keeps the fast lane: the reaction is the live thing then.
 */
export function detailRefreshMsFor(
  hoursUntilEvent: number | null | undefined,
  hasPrinted = false
): number {
  if (hasPrinted) return 15_000;
  const h = num(hoursUntilEvent);
  if (h == null) return 60_000;
  if (h <= 1) return 10_000; // minutes away — the tape into the print is the whole story
  if (h <= 6) return 20_000;
  if (h <= 24) return 45_000;
  if (h <= 72) return 120_000;
  // Beyond three days almost nothing moves between polls; a tighter interval spends budget
  // that the imminent names need.
  return 300_000;
}

/** Hours from now until an ISO instant. Negative once it has passed. */
export function hoursUntilIso(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return round((t - nowMs) / 3_600_000, 4);
}

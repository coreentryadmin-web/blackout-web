import type { BieLevel } from "@/lib/bie/answer-envelope";

/**
 * SIGNAL ROWS — the "Signal · Reading · Bias" table.
 *
 * AN ARROW IS A CLAIM. This is the most dangerous component in the redesign: a green ↑ next to a
 * number is a directional assertion, rendered with more authority than the sentence that produced
 * it, and a member will act on the arrow without reading the prose. So every row here is either
 * COMPUTED from two numbers whose relationship is arithmetic, or looked up in a CLOSED map of desk
 * metrics whose convention is written down. Nothing is inferred from phrasing.
 *
 * TWO SOURCES, BOTH CHECKABLE:
 *
 *  1. LEVEL vs SPOT. "Spot is below VWAP" is arithmetic, not opinion — and the directional reading
 *     of each level is a stated convention (below VWAP is weakness, below the gamma flip is the
 *     short-gamma regime). The convention lives in LEVEL_CONVENTION with the reason attached.
 *
 *  2. NAMED DESK METRICS. TICK, A/D and TRIN have fixed, published polarity. TRIN is the one that
 *     is INVERTED (below 1.0 is bullish) and is exactly the kind of thing a model gets backwards,
 *     which is why it is a table entry and not a heuristic.
 *
 * WHAT IS DELIBERATELY ABSENT: any attempt to read a bias out of evidence prose. A regex over
 * "bullish"/"bearish" in a sentence would fill the table on every answer and would be wrong
 * whenever the sentence was a negation, a comparison, or a quote. FEWER ROWS IS THE CORRECT
 * FAILURE — an empty table says "no scannable signals here", which is honest; a fabricated arrow
 * says "act on this".
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export type SignalBias = "bull" | "bear" | "neutral";

export type SignalRow = {
  /** Display label, already carrying its icon where one is defined. */
  label: string;
  /** The number and its relationship, e.g. "7,753.32 · spot below". */
  reading: string;
  bias: SignalBias;
  /** Why this bias follows — shown on hover/expand so an arrow is never unaccountable. */
  because: string;
};

/**
 * How each level reads when SPOT IS BELOW it. Above simply inverts, except where noted.
 *
 * Only levels whose directional convention is unambiguous appear here. Max pain is deliberately
 * ABSENT: it is a magnet, not a direction — price being under max pain does not make it bullish or
 * bearish, and an arrow would invent a claim the level does not make.
 */
const LEVEL_CONVENTION: Record<string, { belowIsBear: boolean; because: string }> = {
  vwap: {
    belowIsBear: true,
    because: "VWAP is the session's volume-weighted average — trading under it is net distribution",
  },
  "gamma flip": {
    belowIsBear: true,
    because: "below the flip dealers are short gamma and hedge pro-cyclically, amplifying moves",
  },
  "call wall": {
    belowIsBear: false,
    because: "the call wall caps upside; approaching it from below is resistance, not weakness",
  },
  "put wall": {
    belowIsBear: true,
    because: "losing the put wall removes the dealer-supported floor",
  },
  "prior high": { belowIsBear: true, because: "below the prior session high the breakout has not held" },
  "prior low": { belowIsBear: true, because: "trading under the prior session low is continuation lower" },
};

/** Desk internals with fixed polarity. TRIN is inverted — the classic sign error. */
const METRIC_POLARITY: Record<string, { bullWhen: (v: number) => boolean; because: string; icon: string }> = {
  tick: {
    bullWhen: (v) => v > 0,
    because: "NYSE TICK counts upticks minus downticks — positive is broad buying",
    icon: "",
  },
  "a/d": {
    bullWhen: (v) => v > 0,
    because: "advancers minus decliners — positive is broad participation",
    icon: "",
  },
  trin: {
    // INVERTED on purpose: TRIN below 1.0 means volume is concentrated in advancing issues.
    bullWhen: (v) => v < 1,
    because: "TRIN is inverted — under 1.0 means volume favours advancing issues",
    icon: "",
  },
};

const LEVEL_ICON: Record<string, string> = {
  vwap: "📍",
  "gamma flip": "Γ",
  "call wall": "🧱",
  "put wall": "🧱",
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Build signal rows from the answer's levels, relative to spot.
 *
 * Returns `[]` when there is no spot — every row here is a COMPARISON, and without an origin there
 * is nothing to compare. Rendering the levels with no bias column would be fine; rendering them
 * with a guessed one would not.
 */
export function signalRowsFromLevels(levels: readonly BieLevel[] | undefined): SignalRow[] {
  const rows = levels ?? [];
  const spotLevel = rows.find((l) => /^\s*spot\s*$/i.test(String(l?.label ?? "")));
  const spot = typeof spotLevel?.price === "number" && Number.isFinite(spotLevel.price) ? spotLevel.price : null;
  if (spot == null) return [];

  const out: SignalRow[] = [];
  for (const l of rows) {
    if (l === spotLevel) continue;
    const price = l?.price;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;

    const key = String(l.label ?? "").trim().toLowerCase();
    const conv = LEVEL_CONVENTION[key];
    if (!conv) continue; // no stated convention ⇒ no arrow

    const below = spot < price;
    const bias: SignalBias = below === conv.belowIsBear ? "bear" : "bull";
    const icon = LEVEL_ICON[key] ?? "";
    out.push({
      label: `${icon ? `${icon} ` : ""}${l.label}`,
      reading: `${fmt(price)} · spot ${below ? "below" : "above"}`,
      bias,
      because: conv.because,
    });
  }
  return out;
}

/**
 * Build a row for a named desk metric, or null when the metric is not one we have a convention for.
 *
 * Null is the important return. An unknown metric with a plausible-looking number is exactly where
 * a guessed polarity would be invisible and wrong.
 */
export function signalRowForMetric(name: string, value: number | null): SignalRow | null {
  const key = String(name ?? "").trim().toLowerCase();
  const pol = METRIC_POLARITY[key];
  if (!pol || value == null || !Number.isFinite(value)) return null;
  return {
    label: `${pol.icon ? `${pol.icon} ` : ""}${name.toUpperCase()}`,
    reading: fmt(value),
    bias: pol.bullWhen(value) ? "bull" : "bear",
    because: pol.because,
  };
}

/** Tally for the bull-vs-bear split. Neutral rows count toward neither side. */
export function tallySignals(rows: readonly SignalRow[]): { bull: number; bear: number; total: number } {
  return {
    bull: rows.filter((r) => r.bias === "bull").length,
    bear: rows.filter((r) => r.bias === "bear").length,
    total: rows.length,
  };
}

/** The restrained visual language — one glyph per meaning, defined once. */
export const BIAS_GLYPH: Record<SignalBias, string> = { bull: "🟢 ↑", bear: "🔴 ↓", neutral: "🟡 ↔" };

/**
 * Meridian SUMMARY — one call idea, one put idea, and an honest probability for each.
 *
 * ── WHAT A PERCENTAGE IS ALLOWED TO MEAN HERE ────────────────────────────────────────
 * The temptation on a panel like this is to print "72% chance this play works". That number
 * would be invented: nothing in the payload carries a contract price, so profit-at-expiry is
 * not computable, and no amount of confident styling makes it so.
 *
 * What IS computable, from data we actually hold:
 *
 *   IMPLIED    P(close beyond a level), from the options-implied expected move. This is real
 *              math on a real number — the market's own 1σ for this event — under a lognormal
 *              terminal distribution with zero drift. It is a distribution statement, not a
 *              profit statement, and it is labelled as one.
 *   HISTORICAL How this specific name has actually reacted to its own past prints: how often
 *              it moved in that direction, and how big those moves were. A base rate, from
 *              this ticker's own record, with the sample size always shown — 4 prints is not
 *              a probability and must not be dressed as one.
 *   EVIDENCE   Which way the current book leans, as a weighted tally of the pillars that have
 *              an opinion, plus how many disagree.
 *
 * These are reported SEPARATELY and then combined into one confidence, with every component
 * visible. A single blended number with its inputs hidden is exactly the thing a reader cannot
 * check, and this desk's whole argument is that a number you cannot check is worse than none.
 *
 * ── CONTRADICTION IS THE PRODUCT, NOT A PROBLEM ──────────────────────────────────────
 * When the evidence splits, the panel shows BOTH sides with their own numbers rather than
 * forcing a direction. A verdict manufactured from a 3-2 split is a lie about how much the
 * desk knows; showing the split is the finding.
 */

import { clamp, num, round } from "./meridian-viz-core";

/* ── probability primitives ───────────────────────────────────────────────────────── */

/**
 * Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). Max error ~1.5e-7 — far inside
 * anything meaningful for a displayed percentage.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * P(close beyond `level`) implied by the market's own expected move.
 *
 * `movePct` is the options-implied 1σ for the event, so σ = movePct/100 directly — no
 * annualisation, because the move is already scoped to this event rather than to a year.
 * The −σ²/2 term is the lognormal median adjustment: without it the model quietly assumes the
 * stock drifts up by half a variance, which at an 8% implied move is a third of a percent of
 * free bullishness applied to every name.
 *
 * Returns null rather than a guess when the inputs cannot support the calculation.
 */
export function impliedProbBeyond(
  spot: number | null | undefined,
  level: number | null | undefined,
  movePct: number | null | undefined,
  direction: "above" | "below"
): number | null {
  const s = num(spot);
  const k = num(level);
  const m = num(movePct);
  if (s == null || k == null || m == null || s <= 0 || k <= 0 || m <= 0) return null;
  const sigma = m / 100;
  const z = (Math.log(k / s) + (sigma * sigma) / 2) / sigma;
  const pAbove = 1 - normalCdf(z);
  const p = direction === "above" ? pAbove : 1 - pAbove;
  return round(clamp(p, 0, 1), 4);
}

/* ── historical base rate ─────────────────────────────────────────────────────────── */

export type ReactionStats = {
  /** Prints with a usable reaction. Shown ALWAYS — 4 is not a probability. */
  sample: number;
  up: number;
  down: number;
  /** Share that moved up. null below `minSample`, because a rate from 2 prints is noise. */
  upRate: number | null;
  /** Median absolute reaction, percent. Median not mean: one gap dominates a 4-print mean. */
  medianAbsMovePct: number | null;
  /** Largest absolute reaction seen, percent — the tail this name is actually capable of. */
  maxAbsMovePct: number | null;
};

export function reactionStats(
  prints: ReadonlyArray<{ session_change_pct?: number | null; next_day_change_pct?: number | null }> | null | undefined,
  minSample = 3
): ReactionStats {
  const moves: number[] = [];
  for (const p of prints ?? []) {
    // session_change_pct is the reaction the app already anchored to the right session; the
    // next-day value is the fallback only when the anchored one is absent.
    const v = num(p?.session_change_pct) ?? num(p?.next_day_change_pct);
    if (v != null) moves.push(v);
  }
  const up = moves.filter((m) => m > 0).length;
  const down = moves.filter((m) => m < 0).length;
  const abs = moves.map(Math.abs).sort((a, b) => a - b);
  const median =
    abs.length === 0
      ? null
      : abs.length % 2
        ? abs[(abs.length - 1) / 2]!
        : (abs[abs.length / 2 - 1]! + abs[abs.length / 2]!) / 2;
  return {
    sample: moves.length,
    up,
    down,
    upRate: moves.length >= minSample ? round(up / moves.length, 4) : null,
    medianAbsMovePct: median == null ? null : round(median, 2),
    maxAbsMovePct: abs.length ? round(abs[abs.length - 1]!, 2) : null,
  };
}

/* ── evidence lean ────────────────────────────────────────────────────────────────── */

export type EvidenceLean = {
  bullWeight: number;
  bearWeight: number;
  /** −1…1. Sign is direction, magnitude is how lopsided. */
  net: number;
  /** How many pillars took a side at all. */
  voting: number;
  /** True when both sides carry real weight — the panel then refuses to pick one. */
  contested: boolean;
  topBull: string[];
  topBear: string[];
};

export function evidenceLean(
  signals:
    | ReadonlyArray<{ label?: string | null; pillar?: string | null; lean?: string | null; weight?: number | null }>
    | null
    | undefined,
  /** Both sides must clear this share of total weight before a book counts as contested. */
  contestThreshold = 0.35
): EvidenceLean {
  let bull = 0;
  let bear = 0;
  const bullNames: Array<{ n: string; w: number }> = [];
  const bearNames: Array<{ n: string; w: number }> = [];
  for (const s of signals ?? []) {
    const w = Math.abs(num(s?.weight) ?? 1) || 1;
    const name = String(s?.label ?? s?.pillar ?? "").trim();
    if (s?.lean === "bullish") {
      bull += w;
      if (name) bullNames.push({ n: name, w });
    } else if (s?.lean === "bearish") {
      bear += w;
      if (name) bearNames.push({ n: name, w });
    }
  }
  const total = bull + bear;
  const byWeight = (a: { w: number }, b: { w: number }) => b.w - a.w;
  return {
    bullWeight: round(bull, 3),
    bearWeight: round(bear, 3),
    net: total > 0 ? round((bull - bear) / total, 4) : 0,
    voting: bullNames.length + bearNames.length,
    // Contested needs BOTH sides to carry weight. A 5-0 book is not contested however small,
    // and a 1-1 book of trivial pillars should not veto a heavily-weighted read.
    contested: total > 0 && Math.min(bull, bear) / total >= contestThreshold,
    topBull: bullNames.sort(byWeight).slice(0, 3).map((x) => x.n),
    topBear: bearNames.sort(byWeight).slice(0, 3).map((x) => x.n),
  };
}

/* ── the two ideas ────────────────────────────────────────────────────────────────── */

export type SummaryLevel = { label: string; value: number; kind: "wall" | "pin" | "band" | "spot" };

export type PlayIdea = {
  side: "call" | "put";
  /** The level the idea needs the stock to clear. Sourced, never invented — see `levelFrom`. */
  level: number;
  levelFrom: string;
  /** P(close beyond `level`) under the implied move. A DISTRIBUTION statement, not profit. */
  impliedProb: number | null;
  /** This name's own base rate in that direction, with its sample size. */
  historicalRate: number | null;
  historicalSample: number;
  /** −1…1, this side's share of the evidence weight. */
  evidenceNet: number;
  /** 0…100, the three components combined — every input visible above it. */
  confidence: number;
  /** Plain reasons, each traceable to one of the inputs. */
  why: string[];
  /** The level that kills the idea. */
  invalidation: number | null;
};

export type MeridianSummary = {
  spot: number | null;
  movePct: number | null;
  moveSource: string | null;
  call: PlayIdea | null;
  put: PlayIdea | null;
  /** True when the book is split — both ideas stand and neither is promoted. */
  contested: boolean;
  /** The single line at the top. Never manufactures a direction the evidence does not carry. */
  headline: string;
  lean: "bullish" | "bearish" | "neutral";
  levels: SummaryLevel[];
  reaction: ReactionStats;
  evidence: EvidenceLean;
  /** Which inputs were actually available — an absent input must never read as a neutral one. */
  inputs: { thermal: boolean; flow: boolean; darkPool: boolean; history: boolean; move: boolean };
};

export type SummaryInput = {
  spot?: number | null;
  movePct?: number | null;
  moveSource?: string | null;
  band?: { up?: number | null; down?: number | null } | null;
  thermal?: { call_wall?: number | null; put_wall?: number | null; max_pain?: number | null; flip?: number | null } | null;
  prints?: ReadonlyArray<{ session_change_pct?: number | null; next_day_change_pct?: number | null }> | null;
  signals?: Parameters<typeof evidenceLean>[0];
  flowAvailable?: boolean;
  darkPoolAvailable?: boolean;
};

/**
 * Pick the level an idea has to clear.
 *
 * Preference order is by how much the level MEANS, not by convenience: a dealer wall is a real
 * barrier other people are positioned around; the implied-move edge is the market's own 1σ; and
 * only if neither exists do we fall back to deriving one from spot. Every idea carries the
 * source string so the reader can see which of those they are looking at.
 */
function pickLevel(
  side: "call" | "put",
  input: SummaryInput
): { level: number; from: string } | null {
  const spot = num(input.spot);
  const wall = side === "call" ? num(input.thermal?.call_wall) : num(input.thermal?.put_wall);
  const movePctForDist = num(input.movePct);
  // A wall qualifies as a TARGET only if it is on the right side of spot AND a usable distance
  // away. Both bounds came from real payloads, not from taste:
  //   too near — BHP served a call wall of 90.00 against a spot of 89.99. Technically above,
  //              but "get above 90" from 89.99 is not an idea, and it prices at a meaningless
  //              49%.
  //   too far  — BHP's put wall sat 13.9% away on a 5% implied move, which prices the idea at
  //              0%. A level the event cannot reach is not an idea either.
  // Outside that window the implied-move edge is the better level, so we fall through to it.
  if (wall != null && spot != null && spot > 0 && (side === "call" ? wall > spot : wall < spot)) {
    const distSigma =
      movePctForDist != null && movePctForDist > 0
        ? ((Math.abs(wall - spot) / spot) * 100) / movePctForDist
        : null;
    if (distSigma == null || (distSigma >= 0.2 && distSigma <= 1.5)) {
      return { level: wall, from: side === "call" ? "call wall" : "put wall" };
    }
  }
  const edge = side === "call" ? num(input.band?.up) : num(input.band?.down);
  if (edge != null) return { level: edge, from: "implied move edge" };
  const m = num(input.movePct);
  if (spot != null && m != null) {
    return { level: round(spot * (1 + (side === "call" ? m : -m) / 100), 2), from: "implied move" };
  }
  return null;
}

/**
 * Combine the three components into one 0–100 confidence.
 *
 * Weights are stated here rather than tuned into invisibility: the implied probability is the
 * only component with real math behind it, so it carries the most; the evidence lean is a
 * genuine read but a soft one; and the historical base rate is deliberately capped lowest and
 * DROPS OUT ENTIRELY below its minimum sample, rather than letting three prints masquerade as
 * a rate. Re-normalising over present components is what keeps a missing input from silently
 * reading as a neutral 50.
 */
function combineConfidence(implied: number | null, historical: number | null, evidenceNet: number): number {
  const parts: Array<[number, number]> = [];
  if (implied != null) parts.push([implied, 0.5]);
  if (historical != null) parts.push([historical, 0.2]);
  // evidenceNet is −1…1 for this side; map to 0…1.
  parts.push([clamp((evidenceNet + 1) / 2, 0, 1), 0.3]);
  const wSum = parts.reduce((a, [, w]) => a + w, 0);
  const v = parts.reduce((a, [p, w]) => a + p * w, 0) / (wSum || 1);
  return Math.round(clamp(v, 0, 1) * 100);
}

/**
 * Where the idea dies. Must sit on the OPPOSITE side of spot from the target — a stop the price
 * has already passed is not a stop.
 */
function pickInvalidation(side: "call" | "put", spot: number | null, input: SummaryInput): number | null {
  const wantsBelow = side === "call";
  const ok = (v: number | null) =>
    v != null && (spot == null || (wantsBelow ? v < spot : v > spot)) ? v : null;
  return (
    ok(side === "call" ? num(input.thermal?.put_wall) : num(input.thermal?.call_wall)) ??
    ok(side === "call" ? num(input.band?.down) : num(input.band?.up))
  );
}

export function buildMeridianSummary(input: SummaryInput): MeridianSummary {
  const spot = num(input.spot);
  const movePct = num(input.movePct);
  const reaction = reactionStats(input.prints);
  const evidence = evidenceLean(input.signals);

  const levels: SummaryLevel[] = [];
  const pushLevel = (label: string, v: number | null | undefined, kind: SummaryLevel["kind"]) => {
    const n = num(v);
    if (n != null) levels.push({ label, value: n, kind });
  };
  pushLevel("spot", spot, "spot");
  pushLevel("call wall", input.thermal?.call_wall, "wall");
  pushLevel("put wall", input.thermal?.put_wall, "wall");
  pushLevel("max pain", input.thermal?.max_pain, "pin");
  pushLevel("gamma flip", input.thermal?.flip, "pin");
  pushLevel("implied up", input.band?.up, "band");
  pushLevel("implied down", input.band?.down, "band");

  const build = (side: "call" | "put"): PlayIdea | null => {
    const picked = pickLevel(side, input);
    if (!picked) return null;
    const implied = impliedProbBeyond(spot, picked.level, movePct, side === "call" ? "above" : "below");
    const historical =
      reaction.upRate == null ? null : side === "call" ? reaction.upRate : round(1 - reaction.upRate, 4);
    const evNet = side === "call" ? evidence.net : -evidence.net;

    const why: string[] = [];
    if (implied != null && Number.isFinite(implied)) {
      why.push(
        `Options imply a ${(implied * 100).toFixed(0)}% chance of closing ${side === "call" ? "above" : "below"} ${picked.level} (${picked.from})`
      );
    }
    if (historical != null) {
      why.push(
        `${side === "call" ? reaction.up : reaction.down}/${reaction.sample} of this name's last prints reacted ${side === "call" ? "up" : "down"}`
      );
    } else if (reaction.sample > 0) {
      // Say WHY there is no rate rather than omitting the line — an absent number that is
      // never explained reads as an oversight.
      why.push(`Only ${reaction.sample} graded print${reaction.sample === 1 ? "" : "s"} on file — too few for a base rate`);
    }
    const names = side === "call" ? evidence.topBull : evidence.topBear;
    if (names.length) why.push(`Evidence for: ${names.join(", ")}`);
    const against = side === "call" ? evidence.topBear : evidence.topBull;
    if (against.length) why.push(`Against: ${against.join(", ")}`);
    if (reaction.medianAbsMovePct != null && movePct != null && Number.isFinite(movePct) && Number.isFinite(reaction.medianAbsMovePct)) {
      const rich = reaction.medianAbsMovePct < movePct;
      why.push(
        `Implied ${movePct.toFixed(1)}% vs typical realised ${reaction.medianAbsMovePct.toFixed(1)}% — options look ${rich ? "rich" : "cheap"}`
      );
    }

    return {
      side,
      level: picked.level,
      levelFrom: picked.from,
      impliedProb: implied,
      historicalRate: historical,
      historicalSample: reaction.sample,
      evidenceNet: round(evNet, 4),
      confidence: combineConfidence(implied, historical, evNet),
      why,
      // The idea dies where the opposite structure sits — a real level, not a round number.
      // Validated against spot, because the walls themselves can arrive inverted: TGT served
      // call_wall 150 BELOW put_wall 152.5 on a 151.01 spot, which would have put a PUT's
      // invalidation underneath the price it needs to fall from. A level on the wrong side is
      // not a stop, it is a nonsense, so it falls through to the implied-move edge.
      invalidation: pickInvalidation(side, spot, input),
    };
  };

  const call = build("call");
  const put = build("put");
  const contested = evidence.contested;
  const lean: MeridianSummary["lean"] =
    contested || Math.abs(evidence.net) < 0.15 ? "neutral" : evidence.net > 0 ? "bullish" : "bearish";

  let headline: string;
  if (evidence.voting === 0) {
    headline = "No pillar has taken a side — nothing to summarise yet";
  } else if (contested && Number.isFinite(evidence.bullWeight) && Number.isFinite(evidence.bearWeight)) {
    headline = `Evidence is split ${evidence.bullWeight.toFixed(1)} bull vs ${evidence.bearWeight.toFixed(1)} bear — both sides shown, neither promoted`;
  } else if (lean === "neutral") {
    headline = "Evidence is near-balanced — no directional edge worth forcing";
  } else {
    headline = `Evidence leans ${lean} on ${evidence.voting} pillar${evidence.voting === 1 ? "" : "s"}`;
  }

  return {
    spot,
    movePct,
    moveSource: input.moveSource ?? null,
    call,
    put,
    contested,
    headline,
    lean,
    levels: levels.sort((a, b) => b.value - a.value),
    reaction,
    evidence,
    inputs: {
      thermal: input.thermal != null && (num(input.thermal.call_wall) != null || num(input.thermal.put_wall) != null),
      flow: input.flowAvailable === true,
      darkPool: input.darkPoolAvailable === true,
      history: reaction.sample > 0,
      move: movePct != null,
    },
  };
}

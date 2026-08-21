/**
 * GAMMA-LEVELS RESEARCH — the pure derivation behind the public /research/gamma-levels pages.
 *
 * Takes our OWN recorded dealer-gamma wall history for a ticker plus that session's OHLC, and
 * produces the thing the page is actually about: over the trailing window, where did the call and
 * put walls sit, and did price respect them.
 *
 * ── WHAT MAKES THIS PUBLISHABLE ──────────────────────────────────────────────────────────────
 *
 * Every output here is (a) a prior CLOSED session — enforced upstream by publishable-session.ts,
 * (b) DERIVED — our wall classification and our respect statistic, not a vendor field passed
 * through, and (c) AGGREGATE — a window statistic, not a reconstruction of the chain. A reader
 * cannot recover OPRA data from it. That is the whole design constraint; see the publish-boundary
 * module for why it is the constraint.
 *
 * ── TWO DERIVATION CHOICES WORTH STATING ─────────────────────────────────────────────────────
 *
 * 1. A session's wall is its MODAL strike across the session's samples, not its last sample.
 *    The rail records every 5 seconds, so the closing sample is one instant and inherits whatever
 *    the book looked like in the final seconds — which on a pinned expiry is the least stable
 *    moment of the day. The mode answers "where did this wall actually live today", which is both
 *    the more defensible statistic and the one the page's claim is about. Ties break toward the
 *    strike carrying the larger concentration, then the lower strike, so the result is
 *    deterministic — a page that renders differently on two identical inputs is not evidence.
 *
 * 2. "Respected" is measured against the session EXTREME, not the close.
 *    A wall that price closed below but pierced by 2% intraday did not act as resistance; scoring
 *    it a hold because of where the bell happened to ring would inflate every number on the page.
 *    So the call wall holds when the session HIGH stayed within tolerance of it, and the put wall
 *    holds when the session LOW did. Tolerance exists because a wall is a strike and price is
 *    continuous: an exact touch is neither a break nor a clean hold.
 *
 * ── ABSENCE ──────────────────────────────────────────────────────────────────────────────────
 *
 * Sessions with no recorded samples, or no matching bar, are EXCLUDED and COUNTED. `coverage`
 * travels with every statistic so the page can state what it is computed over. A rate printed
 * without its denominator is the failure this repo keeps re-learning: 100% of two sessions and
 * 100% of sixty read identically and mean nothing alike.
 */

import type { GexWalls } from "@/lib/providers/gex-wall-levels";

/** One recorded rail sample, reduced to what this derivation needs. */
export type ResearchSample = {
  walls: GexWalls;
  gammaFlip?: number | null;
};

/** A session's OHLC, from delayed historical daily bars. */
export type ResearchBar = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ResearchSessionInput = {
  session: string;
  samples: readonly ResearchSample[];
  bar: ResearchBar | null;
};

export type WallOutcome = "held" | "broke" | "untested";

export type SessionLevels = {
  session: string;
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  close: number;
  high: number;
  low: number;
  /** Did the call wall cap the session high? `untested` when price never approached it. */
  callWallOutcome: WallOutcome;
  putWallOutcome: WallOutcome;
  /** Closed above the gamma flip = the long-gamma (dampened) side of the line. */
  closedAboveFlip: boolean | null;
};

export type Coverage = {
  /** Sessions we asked for. */
  requested: number;
  /** Sessions that produced a usable row. */
  covered: number;
  /** Sessions dropped, with the reason — never a silent gap. */
  missing: Array<{ session: string; reason: "no_samples" | "no_bar" | "no_walls" }>;
};

export type WallStat = {
  /** Sessions where the wall existed AND price came close enough to test it. */
  tested: number;
  held: number;
  /** null when nothing was tested — a rate over zero sessions is not a number worth printing. */
  holdRate: number | null;
};

export type GammaLevelsResearch = {
  ticker: string;
  window: { from: string; to: string } | null;
  coverage: Coverage;
  sessions: SessionLevels[];
  callWall: WallStat;
  putWall: WallStat;
  /** Sessions closed above the gamma flip, out of those with a flip recorded. */
  flip: { sessions: number; closedAbove: number; aboveRate: number | null };
  /** Distinct call-wall strikes in the window, most-frequent first — the "sticky levels" read. */
  recurringCallWalls: Array<{ strike: number; sessions: number }>;
  recurringPutWalls: Array<{ strike: number; sessions: number }>;
};

/**
 * How close price must come before a wall counts as TESTED, and how far past it before the wall
 * counts as BROKEN — both as a fraction of the wall's own price.
 *
 * 0.15% is roughly a normal SPX strike interval at current index levels, so a "test" means price
 * reached the neighbourhood of the strike rather than merely trading somewhere that session.
 * Without a tested/untested split, a wall 8% away would score a free "hold" every quiet day and
 * the statistic would measure distance, not resistance.
 */
export const WALL_TEST_TOLERANCE = 0.0015;

/** Deterministic modal strike from a session's samples, or null when the side never had a wall. */
function modalStrike(samples: readonly ResearchSample[], side: "callWalls" | "putWalls"): number | null {
  const seen = new Map<number, { sessions: number; weight: number }>();
  for (const s of samples) {
    const top = s.walls?.[side]?.[0];
    if (!top || !Number.isFinite(top.strike)) continue;
    const prev = seen.get(top.strike) ?? { sessions: 0, weight: 0 };
    prev.sessions += 1;
    prev.weight += Number.isFinite(top.pct) ? top.pct : 0;
    seen.set(top.strike, prev);
  }
  if (seen.size === 0) return null;
  // Sort is total and deterministic: frequency, then concentration, then the lower strike.
  const ranked = [...seen.entries()].sort(
    (a, b) => b[1].sessions - a[1].sessions || b[1].weight - a[1].weight || a[0] - b[0]
  );
  return ranked[0][0];
}

/** Median gamma flip across the session's samples — robust to the odd spike the mean is not. */
function medianFlip(samples: readonly ResearchSample[]): number | null {
  const vals = samples
    .map((s) => s.gammaFlip)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Did the wall hold?
 *
 * `extreme` is the session high for a call wall and the session low for a put wall. A wall price
 * of zero or less is not a strike and yields `untested` rather than a division by zero.
 */
export function classifyWallOutcome(
  wall: number | null,
  extreme: number,
  side: "call" | "put",
  tolerance: number = WALL_TEST_TOLERANCE
): WallOutcome {
  if (wall === null || !Number.isFinite(wall) || wall <= 0 || !Number.isFinite(extreme)) {
    return "untested";
  }
  const band = wall * tolerance;
  if (side === "call") {
    if (extreme < wall - band) return "untested"; // never reached the level
    return extreme > wall + band ? "broke" : "held";
  }
  if (extreme > wall + band) return "untested";
  return extreme < wall - band ? "broke" : "held";
}

function tally(sessions: readonly SessionLevels[], key: "callWallOutcome" | "putWallOutcome"): WallStat {
  let tested = 0;
  let held = 0;
  for (const s of sessions) {
    if (s[key] === "untested") continue;
    tested += 1;
    if (s[key] === "held") held += 1;
  }
  return { tested, held, holdRate: tested > 0 ? held / tested : null };
}

function recurring(
  sessions: readonly SessionLevels[],
  key: "callWall" | "putWall",
  limit = 5
): Array<{ strike: number; sessions: number }> {
  const counts = new Map<number, number>();
  for (const s of sessions) {
    const v = s[key];
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2) // a level seen once is not "recurring"; saying so would be a lie
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([strike, n]) => ({ strike, sessions: n }));
}

/**
 * Build the research payload for one ticker over a window of publishable sessions.
 *
 * Input order does not matter; output sessions are newest-first, which is how the page reads them.
 */
export function buildGammaLevelsResearch(
  ticker: string,
  inputs: readonly ResearchSessionInput[],
  tolerance: number = WALL_TEST_TOLERANCE
): GammaLevelsResearch {
  const missing: Coverage["missing"] = [];
  const rows: SessionLevels[] = [];

  for (const input of inputs) {
    if (!input.samples || input.samples.length === 0) {
      missing.push({ session: input.session, reason: "no_samples" });
      continue;
    }
    if (!input.bar || !Number.isFinite(input.bar.close)) {
      missing.push({ session: input.session, reason: "no_bar" });
      continue;
    }
    const callWall = modalStrike(input.samples, "callWalls");
    const putWall = modalStrike(input.samples, "putWalls");
    if (callWall === null && putWall === null) {
      missing.push({ session: input.session, reason: "no_walls" });
      continue;
    }
    const gammaFlip = medianFlip(input.samples);
    rows.push({
      session: input.session,
      callWall,
      putWall,
      gammaFlip,
      close: input.bar.close,
      high: input.bar.high,
      low: input.bar.low,
      callWallOutcome: classifyWallOutcome(callWall, input.bar.high, "call", tolerance),
      putWallOutcome: classifyWallOutcome(putWall, input.bar.low, "put", tolerance),
      closedAboveFlip: gammaFlip === null ? null : input.bar.close > gammaFlip,
    });
  }

  rows.sort((a, b) => (a.session < b.session ? 1 : a.session > b.session ? -1 : 0));

  const withFlip = rows.filter((r) => r.closedAboveFlip !== null);
  const closedAbove = withFlip.filter((r) => r.closedAboveFlip).length;

  return {
    ticker,
    window: rows.length > 0 ? { from: rows[rows.length - 1].session, to: rows[0].session } : null,
    coverage: { requested: inputs.length, covered: rows.length, missing },
    sessions: rows,
    callWall: tally(rows, "callWallOutcome"),
    putWall: tally(rows, "putWallOutcome"),
    flip: {
      sessions: withFlip.length,
      closedAbove,
      aboveRate: withFlip.length > 0 ? closedAbove / withFlip.length : null,
    },
    recurringCallWalls: recurring(rows, "callWall"),
    recurringPutWalls: recurring(rows, "putWall"),
  };
}

/**
 * Is there enough here to publish a page at all?
 *
 * A page built on three sessions is a thin page making a statistical claim it cannot support —
 * bad for the reader and, as a mass-produced URL, bad for the site. Below the floor the route
 * serves a 404 rather than a page with nothing in it.
 */
export const MIN_SESSIONS_TO_PUBLISH = 10;

export function isPublishable(research: GammaLevelsResearch): boolean {
  return research.coverage.covered >= MIN_SESSIONS_TO_PUBLISH;
}

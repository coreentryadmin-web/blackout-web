/**
 * Meridian DRIFT — how the desk's read on a name has CHANGED as its print approached.
 *
 * "The model was bullish five days ago and is neutral now" is often a better signal than either
 * level on its own: a verdict that has been decaying toward neutral while the print nears means
 * something different from one that arrived neutral and stayed there. Nothing in Meridian could
 * express that, because nothing was stored.
 *
 * ── WHY THIS IS A DAY SERIES, NOT AN INTRADAY ONE ────────────────────────────────────
 * One row per (ticker, event, calendar day), last write wins. The warm path runs every few
 * minutes, so an unkeyed insert would produce a few hundred near-identical rows per name per
 * day and a "drift" that mostly measured scan jitter. Collapsing to a day makes each point a
 * real observation, and makes a missed run harmless: the next pass that day overwrites the same
 * slot rather than leaving a hole.
 *
 * ── WHAT COUNTS AS A CHANGE ──────────────────────────────────────────────────────────
 * A verdict FLIP (bullish → bearish, or either → neutral) is reported on its own, because it is
 * categorical and a reader will want to know it happened regardless of how small the score move
 * was. Score drift is reported separately and only when it clears a floor — a score that moved
 * by 1 point is noise wearing a direction, and reporting it would train the reader to ignore
 * this panel.
 */

import { clamp, num, round } from "./meridian-viz-core";

export type ReportSnapshot = {
  /** YYYY-MM-DD in ET. One row per day per event. */
  day: string;
  score: number | null;
  verdict: "bullish" | "bearish" | "neutral" | null;
  confidence: string | null;
  /** Per-pillar leans at that moment: `pillar -> lean`. Used to name WHICH pillar turned. */
  pillars?: Record<string, string> | null;
};

export type PillarTurn = { pillar: string; from: string; to: string };

export type MeridianDrift = {
  /** Oldest and newest snapshots actually compared. */
  from: ReportSnapshot;
  to: ReportSnapshot;
  /** Calendar days between them. */
  spanDays: number | null;
  scoreDelta: number | null;
  /** True when the verdict changed category. Reported regardless of score movement. */
  verdictFlipped: boolean;
  /** Direction of travel, once noise is excluded. */
  direction: "firming" | "fading" | "flat" | "unknown";
  /** Pillars that changed side between the two snapshots — the WHY behind the move. */
  turns: PillarTurn[];
  /** One line for the panel. Never claims movement that is inside the noise floor. */
  headline: string;
  /** How many snapshots exist. A 2-point series is a comparison, not a trend — say which. */
  sampleDays: number;
};

/** Below this a score move is not reported as drift. Stated, not buried in a comparison. */
export const DRIFT_SCORE_FLOOR = 5;

function daysBetween(a: string, b: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

function pillarTurns(from: ReportSnapshot, to: ReportSnapshot): PillarTurn[] {
  const a = from.pillars ?? {};
  const b = to.pillars ?? {};
  const out: PillarTurn[] = [];
  for (const [pillar, toLean] of Object.entries(b)) {
    const fromLean = a[pillar];
    // Only a pillar present in BOTH snapshots can be said to have turned. One that simply
    // appeared is new evidence, not a change of mind, and conflating them would invent flips
    // every time a feed came back online.
    if (fromLean && toLean && fromLean !== toLean) out.push({ pillar, from: fromLean, to: toLean });
  }
  return out.sort((x, y) => x.pillar.localeCompare(y.pillar));
}

/**
 * Compare the newest snapshot against the oldest one inside `lookbackDays`.
 *
 * Oldest-inside-window rather than "exactly N days ago": snapshots are only written on days the
 * warm path ran, so demanding an exact date would return nothing over a weekend or a holiday —
 * precisely the gaps an earnings calendar is full of.
 */
export function computeMeridianDrift(
  snapshots: readonly ReportSnapshot[] | null | undefined,
  lookbackDays = 7
): MeridianDrift | null {
  const rows = [...(snapshots ?? [])]
    .filter((s) => s && /^\d{4}-\d{2}-\d{2}$/.test(s.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (rows.length < 2) return null;

  const to = rows[rows.length - 1]!;
  // The oldest row inside the window that is NOT the newest one. Excluding `to` matters: when
  // the only in-window snapshot is today's, the naive search returns `to` itself and the whole
  // comparison collapses to nothing — which is exactly the case where a reader most wants the
  // older reading. Falls back to the oldest row overall, so a long-dormant name still compares.
  const cutoff = rows.findIndex((r) => {
    if (r.day === to.day) return false;
    const d = daysBetween(r.day, to.day);
    return d != null && d <= lookbackDays;
  });
  const from = rows[cutoff >= 0 ? cutoff : 0]!;
  if (from.day === to.day) return null;

  const spanDays = daysBetween(from.day, to.day);
  const a = num(from.score);
  const b = num(to.score);
  const scoreDelta = a != null && b != null ? round(b - a, 2) : null;
  const verdictFlipped = Boolean(from.verdict && to.verdict && from.verdict !== to.verdict);
  const turns = pillarTurns(from, to);

  let direction: MeridianDrift["direction"] = "unknown";
  if (scoreDelta != null) {
    if (Math.abs(scoreDelta) < DRIFT_SCORE_FLOOR) direction = "flat";
    else direction = scoreDelta > 0 ? "firming" : "fading";
  }

  const span = spanDays == null ? "recently" : spanDays === 1 ? "since yesterday" : `over ${spanDays}d`;
  let headline: string;
  if (verdictFlipped) {
    headline = `Verdict moved ${from.verdict} → ${to.verdict} ${span}`;
  } else if (direction === "firming" || direction === "fading") {
    headline = `Read is ${direction} ${span} (${scoreDelta! > 0 ? "+" : ""}${scoreDelta})`;
  } else if (direction === "flat") {
    // Say "held", not "no change" — a read that survived a week of new information is itself
    // a finding, and it is not the same statement as "we have no data".
    headline = `Read has held ${span}`;
  } else {
    headline = `Tracking since ${from.day}`;
  }

  return {
    from,
    to,
    spanDays,
    scoreDelta,
    verdictFlipped,
    direction,
    turns,
    headline,
    sampleDays: rows.length,
  };
}

/** Sparkline-ready score series, oldest first. Nulls preserved — a gap is not a zero. */
export function driftSeries(snapshots: readonly ReportSnapshot[] | null | undefined): Array<number | null> {
  return [...(snapshots ?? [])]
    .filter((s) => s && /^\d{4}-\d{2}-\d{2}$/.test(s.day))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => {
      const v = num(s.score);
      return v == null ? null : round(clamp(v, -100, 100), 2);
    });
}

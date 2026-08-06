/**
 * COMMAND DECK — list ordering (pure, display-only).
 *
 * Operators want the working book on top and the dead plays out of the way: OPEN plays first,
 * WATCH setups in the middle, CLOSED plays sunk to the bottom. This is a presentation-only
 * re-order — it never touches scoring, gating, or which plays exist; the incoming array is already
 * score-ranked, and we preserve that order *within* each group (stable partition).
 */

import type { DeckStatus, TerminalPlay } from "./types";
import { playQualityPct } from "./play-card-display";
import { playListReturnPct, playTriggeredAtMs } from "./play-card-lifecycle";

/** Which visual band a status belongs to. Lower rank sorts higher (nearer the top). */
function statusBand(status: DeckStatus): 0 | 1 | 2 {
  switch (status) {
    // Working book — live money or actively managed.
    case "OPEN":
    case "HOLD":
    case "TRIM":
      return 0;
    // Pre-entry setups being watched (SKIP = evaluated-but-passed, still a watch-grade row).
    case "WATCH":
    case "SKIP":
      return 1;
    // Done — sunk to the bottom.
    case "CLOSED":
      return 2;
  }
}

/**
 * Return a NEW array ordered OPEN(top) → WATCH(middle) → CLOSED(bottom), STABLE within each band so
 * the incoming score-ranked order is preserved per group. Never mutates the input.
 */
export function sortPlaysForDeck(plays: TerminalPlay[]): TerminalPlay[] {
  // Stable partition by band. A single stable sort on the band key would also work, but an explicit
  // three-bucket pass makes the "stable within group" guarantee obvious and independent of the
  // engine's sort stability.
  const open: TerminalPlay[] = [];
  const watch: TerminalPlay[] = [];
  const closed: TerminalPlay[] = [];
  for (const p of plays) {
    const band = statusBand(p.status);
    if (band === 0) open.push(p);
    else if (band === 1) watch.push(p);
    else closed.push(p);
  }
  return [...open, ...watch, ...closed];
}

// ── Conviction sort (Wave 2, optional/additive) ──────────────────────────────────────
// A SECOND lens over the SAME list, alongside (never replacing) the status sort: rank by the
// engine's own conviction signals — merit tier × confluence × tape-alignment — so the highest-
// conviction plays float regardless of open/watch/closed banding. Pure + display-only; the incoming
// array is untouched. Every input degrades safely: a play carrying none of the three signals scores 0
// and holds its incoming (score-ranked) position via the stable tie-break.

export type DeckSortMode = "status" | "rating" | "time" | "peak";

/** Merit-tier letter → an ordinal (higher = better). A+ tops it; an unknown/absent tier is 0 (no
 *  conviction credit — never a fabricated grade). Case-insensitive; the "+" adds a half-step so A+
 *  beats A but sits below a full grade jump. */
export function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const t = tier.trim().toUpperCase();
  const base: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
  const letter = t[0] ?? "";
  const rank = base[letter];
  if (rank == null) return 0;
  return rank + (t.includes("+") ? 0.5 : t.includes("-") ? -0.25 : 0);
}

/** Tape-alignment contribution from the live thesis read: a confirmed-intact tape is conviction, a
 *  degrading/broken one is a penalty, and a DATA-ABSENT ("unknown") read is neutral 0 — the same
 *  9-6c honesty the adapter applies (absence is never treated as a confirmed green). */
export function tapeAlignScore(play: Pick<TerminalPlay, "thesisBreak">): number {
  switch (play.thesisBreak?.level) {
    case "intact":
      return 1;
    case "warn":
      return -1;
    case "break":
      return -2;
    default:
      return 0; // "unknown" or absent — neutral, not a fabricated confirmation
  }
}

/**
 * Composite conviction score for the conviction sort. Weights: tier is the heaviest lever (the
 * engine's earned merit grade), confluence next (0–2 confirmations), tape-alignment a lighter tilt.
 * Pure; higher = more conviction. Exposed for the unit tests.
 */
export function convictionScore(
  play: Pick<TerminalPlay, "tierLabel" | "confluence" | "thesisBreak">,
): number {
  return tierRank(play.tierLabel) * 3 + (play.confluence ?? 0) * 2 + tapeAlignScore(play);
}

/**
 * Return a NEW array ranked by conviction DESCENDING, STABLE for ties (incoming score-ranked order is
 * preserved among equal-conviction plays). Never mutates the input. Ties fall back to the raw `score`
 * then leave the original order — deterministic, no ticker coin-flip that would reorder on each poll.
 */
export function sortPlaysByConviction(plays: TerminalPlay[]): TerminalPlay[] {
  return plays
    .map((p, i) => ({ p, i, c: convictionScore(p) }))
    .sort((a, b) => b.c - a.c || b.p.score - a.p.score || a.i - b.i)
    .map((x) => x.p);
}

/** Card-visible rating — tier ordinal dominates, quality/score breaks ties. */
export function ratingSortKey(play: TerminalPlay): number {
  const tier = tierRank(play.tierLabel) * 1000;
  const quality = playQualityPct(play) ?? (Number.isFinite(play.score) ? play.score : 0);
  return tier + quality;
}

/** Highest grade/score first — matches the inline B 82 badge on list rows. */
export function sortPlaysByRating(plays: TerminalPlay[]): TerminalPlay[] {
  return plays
    .map((p, i) => ({ p, i, r: ratingSortKey(p) }))
    .sort((a, b) => b.r - a.r || b.p.score - a.p.score || a.i - b.i)
    .map((x) => x.p);
}

/** Most recently triggered/discovered first — grounded timestamps only. */
export function sortPlaysByTriggeredTime(plays: TerminalPlay[]): TerminalPlay[] {
  return plays
    .map((p, i) => ({ p, i, t: playTriggeredAtMs(p) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.p);
}

/** Best peak/track/live return first — same read as the compact list column. */
export function sortPlaysByPeak(plays: TerminalPlay[]): TerminalPlay[] {
  return plays
    .map((p, i) => ({ p, i, r: playListReturnPct(p) }))
    .sort((a, b) => {
      const ar = a.r ?? -Infinity;
      const br = b.r ?? -Infinity;
      return br - ar || a.i - b.i;
    })
    .map((x) => x.p);
}

/** Dispatch the active sort mode — status banding default; rating/time/peak are member lenses. */
export function sortPlaysForDeckBy(plays: TerminalPlay[], mode: DeckSortMode): TerminalPlay[] {
  switch (mode) {
    case "rating":
      return sortPlaysByRating(plays);
    case "time":
      return sortPlaysByTriggeredTime(plays);
    case "peak":
      return sortPlaysByPeak(plays);
    default:
      return sortPlaysForDeck(plays);
  }
}

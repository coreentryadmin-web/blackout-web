/**
 * COMMAND DECK — list ordering (pure, display-only).
 *
 * Operators want the working book on top and the dead plays out of the way: OPEN plays first,
 * WATCH setups in the middle, CLOSED plays sunk to the bottom. This is a presentation-only
 * re-order — it never touches scoring, gating, or which plays exist; the incoming array is already
 * score-ranked, and we preserve that order *within* each group (stable partition).
 */

import type { DeckStatus, TerminalPlay } from "./types";

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

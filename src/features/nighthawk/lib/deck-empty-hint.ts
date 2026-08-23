// The 0DTE deck's empty-state sentence.
//
// WHY THIS IS A MODULE AND NOT AN INLINE TERNARY. The hint used to be a BINARY —
// `degraded ? "data unavailable" : "Scanning the whole market — no 0DTE setup has cleared the
// floor right now."` — but the deck has THREE states, not two, and the third silently borrowed
// the third-party wording of the second:
//
//   1. degraded          — the board could not be read. Already handled (containers.tsx:86 has
//                          the comment explaining why a degraded board must not be painted as a
//                          calm flat tape — correct, and it stopped one state short).
//   2. NOT SCANNING      — market closed, or pre-market. There is no live tape to scan, so
//                          "no setup has cleared the floor" is a claim about a scan that never ran.
//   3. scanning, empty   — the engine really did sweep the market and nothing qualified. This is
//                          the only state the original sentence is true in.
//
// MEASURED 2026-08-23 (Sat, market closed): /nighthawk rendered the header badge `ENGINE Standby`
// and, in the same component driven by the same prop, the body text "Scanning the whole market —
// no 0DTE setup has cleared the floor right now." Two contradictory claims on screen at once. The
// board payload was entirely honest at that moment — `session.trading_day:false`,
// `session.heat.state:"CLOSED"`, and BOTH discovery lanes `{"status":"off_hours"}` — so this was
// never missing data. The UI had every fact and discarded them.
//
// This is `_COMMON.md` rule 7 ("absence is a finding, not a blank") at the render layer, and it is
// the exact conflation `discovery_health` exists to prevent: NIGHTHAWK-MAP.md §4.3 — "`ok` means
// the lane RAN and its count is a real measurement of the market (zero included). Every other
// status means the count is not a market read at all." An `off_hours` zero was being drawn as an
// `ok` zero.
//
// The fix PREFERS THE PAYLOAD'S OWN SENTENCE (`session.heat.note`) over new invented copy: the
// data layer already writes an accurate member-facing line for every heat state (board.ts
// sessionHeat), so reusing it keeps one source of truth and means a future wording change lands
// in one place. The literals below are only a fallback for a payload that predates `note`.

/** Heat states in which NO live whole-market 0DTE scan is running, so an empty board must not be
 *  described as "nothing cleared the floor".
 *
 *  Deliberately NOT including POST_COMMIT / LATE_SESSION: after 15:30 ET the board genuinely is
 *  still scanning (G-14 blocks new DIRECTIONAL commits but credit/condor seats remain eligible),
 *  so the active-scan wording is defensible there and widening this set would be a copy change
 *  without evidence behind it. */
const NOT_SCANNING_STATES: ReadonlySet<string> = new Set(["CLOSED", "PRE_MARKET"]);

/** Fallback copy, used ONLY when the payload carries no `heat.note` (legacy/cached board). */
const FALLBACK_NOT_SCANNING: Record<string, string> = {
  CLOSED: "Market closed — no session to scan. Tonight's evening playbook covers the next open.",
  PRE_MARKET: "Pre-market — feeds still warming. Whole-market 0DTE discovery starts at the open.",
};

const GENERIC_NOT_SCANNING = "Market closed — whole-market 0DTE discovery runs during the session.";

export type ZeroDteEmptyHintInput = {
  degraded: boolean;
  /** `session.heat.state` from the board payload; null when unknown (first load). */
  heatState: string | null | undefined;
  /** `session.heat.note` — the data layer's own member-facing sentence for this state. */
  heatNote?: string | null;
};

/**
 * The sentence to show when the 0DTE deck has no plays. Pure.
 *
 * An UNKNOWN heat state (null — a first load, or a cached payload without `session`) falls through
 * to the scanning wording, which is the pre-existing behaviour: this fix narrows a false claim, it
 * does not invent a new "we don't know" state that the deck has no design for.
 */
export function zeroDteEmptyHint(input: ZeroDteEmptyHintInput): string {
  if (input.degraded) {
    return "Board data unavailable right now — retrying. Any open position is still live; this is a data outage, not a flat tape.";
  }
  const state = String(input.heatState ?? "").toUpperCase();
  if (NOT_SCANNING_STATES.has(state)) {
    const note = input.heatNote?.trim();
    if (note) return note;
    return FALLBACK_NOT_SCANNING[state] ?? GENERIC_NOT_SCANNING;
  }
  return "Scanning the whole market — no 0DTE setup has cleared the floor right now.";
}

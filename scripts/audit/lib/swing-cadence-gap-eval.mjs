/**
 * Pure helpers for `swing-cadence-gap-recall-probe.mjs` — see that script's header for the full
 * WHY. Deliberately network/DB-free so this class of logic (gap-window derivation, qualifying-
 * transition classification, forgone-move grading) is unit-testable in isolation and never
 * silently reimplemented/drifted inside the live harness itself.
 */

/**
 * Derive the GAP windows (uncovered ET minutes-of-day) as the complement of the real
 * `SWING_SCAN_PHASES` windows (`src/lib/swing/scan-cadence.ts`) — the harness passes that real
 * array in rather than this file hardcoding 9:15/12:00/13:00/15:00 as a second, driftable copy of
 * scan-cadence.ts's own source of truth. Assumes non-overlapping windows (scan-cadence.ts's own
 * documented invariant); does not assume any particular input order. Returns gaps sorted by
 * `startMin`, each `{ startMin, endMin }` in [dayStartMin, dayEndMin).
 */
export function deriveGapWindows(phaseWindows, dayStartMin = 0, dayEndMin = 24 * 60) {
  const sorted = [...phaseWindows].sort((a, b) => a.startMin - b.startMin);
  const gaps = [];
  let cursor = dayStartMin;
  for (const w of sorted) {
    if (w.startMin > cursor) gaps.push({ startMin: cursor, endMin: w.startMin });
    cursor = Math.max(cursor, w.endMin);
  }
  if (cursor < dayEndMin) gaps.push({ startMin: cursor, endMin: dayEndMin });
  return gaps;
}

/**
 * Classify one ticker's FLOW-accumulation qualifying transition across one gap window, given
 * whether it was already directional (non-neutral per `accumulationSignalsFromFlow`) at the gap's
 * START boundary and at its END boundary:
 *   - "already_covered": qualified before the gap even began — the LAST covered phase already
 *     had a chance to see it; this gap did not cause a miss.
 *   - "gap_qualified": neutral at gap start, directional by gap end — it became a real FLOW
 *     candidate SOMEWHERE inside the gap, invisible to discovery until the NEXT covered phase.
 *     This is the case the probe measures.
 *   - "never_qualified": still neutral even at gap end — nothing to measure for this gap.
 */
export function classifyGapTransition({ directionalAtGapStart, directionalAtGapEnd }) {
  if (directionalAtGapStart) return "already_covered";
  if (!directionalAtGapEnd) return "never_qualified";
  return "gap_qualified";
}

/**
 * Refine a gap-qualified ticker's precise qualifying moment by walking its OWN alert timestamps
 * inside the gap in ascending order and re-testing the REAL production engine at each one via the
 * injected `isDirectionalAsOf(ms)` predicate — never analytic, never guessed. Returns the first
 * timestamp confirmed directional, or null if none of the supplied candidates are (a caller bug —
 * the caller should only invoke this once `classifyGapTransition` has already returned
 * "gap_qualified" for this ticker/gap — or a same-timestamp race in the source data), which the
 * caller must treat as "could not refine", never silently falling back to a boundary guess.
 */
export function findFirstDirectionalMs(orderedCandidateMs, isDirectionalAsOf) {
  for (const ms of orderedCandidateMs) {
    if (isDirectionalAsOf(ms)) return ms;
  }
  return null;
}

/**
 * Grade the forgone move for a gap-qualified ticker: its OWN underlying price move, SIGN-ALIGNED
 * to its OWN accumulation direction, from the (refined) qualifying moment to the next covered
 * phase's start — the instant discovery would first actually see it. A positive `movePct` means
 * the move already ran favorably in the candidate's own direction before discovery could ever
 * react to it (the real cost of the gap); a non-positive one means it moved against its own thesis
 * or sideways by the time discovery caught up (the gap cost nothing here). Never fabricates a
 * result from missing/invalid prices — returns null instead, same "never fabricate" discipline as
 * every other evidence-only helper in this audit toolkit.
 */
export function gradeForgoneMove({ qualifyingPrice, catchUpPrice, direction, favThresholdPct }) {
  if (
    qualifyingPrice == null || !Number.isFinite(qualifyingPrice) || qualifyingPrice <= 0 ||
    catchUpPrice == null || !Number.isFinite(catchUpPrice) || catchUpPrice <= 0
  ) {
    return null;
  }
  const rawPct = ((catchUpPrice - qualifyingPrice) / qualifyingPrice) * 100;
  const movePct = direction === "bear" ? -rawPct : rawPct;
  return { movePct, favorable: movePct >= favThresholdPct };
}

/**
 * Robust ET wall-clock (YYYY-MM-DD, minutes-since-midnight) -> UTC epoch ms, correct across the
 * EDT/EST boundary without a hardcoded seasonal offset (unlike a naive `Date.UTC(y,m,d,hh+4,mm)`
 * assumption). Converges in at most 2 iterations: start from an EST-assuming guess, read back what
 * ET wall-clock that guess actually represents via `Intl.DateTimeFormat`, and correct by the delta
 * — the standard fixed-point trick for "local wall time -> UTC" when the offset itself is unknown
 * up front. Pure/deterministic (no network), so it lives here rather than only in the live script.
 */
export function etWallClockToUtcMs(dateYmd, minutesSinceMidnight) {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const hh = Math.floor(minutesSinceMidnight / 60);
  const mm = minutesSinceMidnight % 60;
  const wantMs = Date.UTC(y, mo - 1, d, hh, mm);
  let guess = Date.UTC(y, mo - 1, d, hh + 5, mm); // EST-assuming first guess
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const gotMsAsIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const diff = wantMs - gotMsAsIfUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

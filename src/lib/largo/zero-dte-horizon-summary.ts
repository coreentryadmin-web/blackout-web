/**
 * The 0DTE half of `get_nighthawk_horizons` — and the one rule it kept breaking.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────
 *
 * `nighthawkHorizonsForLargo` read the 0DTE lane through
 * `zeroDtePlaysForLargo().catch(() => ({ available: false, plays: [] }))` and then counted that
 * `plays` array. So a failed 0DTE read was published as:
 *
 *     zero_dte: { play_count: 0, open_count: 0, sample: [] }
 *
 * inside an envelope stamped `available: true`. The fallback did not merely lose the error — it
 * MANUFACTURED the empty array that the very next line counted, and the count came out zero. A
 * member asking "what is open right now" during a 0DTE outage was told "nothing".
 *
 * This is the third appearance of one shape in this lane: #2477 (live feed), #2492
 * (`get_zerodte_plays` itself), and here. And the two fixes interact badly without this one —
 * #2492 makes `zeroDtePlaysForLargo` OMIT `plays` entirely when the board is unreadable, precisely
 * so nothing can count zero, and the `Array.isArray(...) ? ... : []` guard downstream converted
 * that honest unknown straight back into `0`. An honest producer is not enough if its consumer
 * launders the answer.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 *
 * A count is a measurement. When the read behind it is unknown there is no count — not zero, and
 * not a key holding zero. The summary returns `available: false` with a reason and NO numeric
 * fields at all, so there is nothing for a model to quote.
 */

export type ZeroDteHorizonSummary =
  | { available: true; play_count: number; open_count: number; sample: string[] }
  | { available: false; reason: string; note: string };

type MaybePlay = { ticker?: unknown; status?: unknown; direction?: unknown };

const UNKNOWN_NOTE =
  "The 0DTE lane could not be read for this session, so the number of open 0DTE plays is " +
  "UNKNOWN. It is deliberately not reported as 0 — do not say the board is quiet, say the 0DTE " +
  "lane is unavailable.";

/**
 * @param zerodte whatever `zeroDtePlaysForLargo()` returned, or `null` if the call threw.
 */
export function zeroDteHorizonSummary(zerodte: unknown): ZeroDteHorizonSummary {
  if (zerodte == null || typeof zerodte !== "object") {
    return { available: false, reason: "zerodte_read_failed", note: UNKNOWN_NOTE };
  }
  const src = zerodte as { available?: unknown; plays?: unknown; reason?: unknown };

  // An explicit `available: false` from the producer is an answer, and the answer is "unknown".
  if (src.available === false) {
    return {
      available: false,
      reason: typeof src.reason === "string" && src.reason ? src.reason : "zerodte_unavailable",
      note: UNKNOWN_NOTE,
    };
  }

  // No `plays` key is ALSO unknown, not empty — #2492 omits it on purpose for exactly this case.
  if (!Array.isArray(src.plays)) {
    return { available: false, reason: "zerodte_plays_absent", note: UNKNOWN_NOTE };
  }

  const plays = src.plays as MaybePlay[];
  const open = plays.filter((p) => !/closed|graded/i.test(String(p?.status ?? "")));
  return {
    available: true,
    play_count: plays.length,
    open_count: open.length,
    sample: open.slice(0, 6).map((p) => `${String(p?.ticker ?? "?")} ${String(p?.direction ?? "?")} (${String(p?.status ?? "?")})`),
  };
}

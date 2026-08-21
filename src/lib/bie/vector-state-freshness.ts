// Freshness disclosure for the cached Vector desk state.
//
// Side-effect-free (NO `import "server-only"`) so it is unit-testable under `tsx --test`.
//
// WHY THIS EXISTS
// ---------------
// `fetchVectorFullState` is cache-FIRST: it serves a Redis snapshot written either by the
// `vector-full-state-snapshot` cron or by an earlier reader's self-warm, and that snapshot carries
// the `asOf` of the moment it was COMPUTED — not the moment it was read. The staleness window is
// real and it is not small:
//
//  - the cron is RTH-gated (`2-59/5 11-21 * * 1-5`), so OFF-HOURS nothing refreshes the cache at
//    all and an entry simply ages until the 15-minute TTL drops it;
//  - it warms only the ~55 allowlist names, while Vector deliberately serves ANY optionable
//    symbol — an off-allowlist ticker is only ever warmed by a reader's own self-warm;
//  - its serial critical path is 76 computes against a 50s time budget, so every
//    `computeVectorFullState` must finish inside ~658ms for the sweep to cover the universe.
//    It is written to truncate rather than overrun ("partial completion is fine — the snapshots
//    carry `asOf`"), and the tickers it does not reach keep their older entry.
//
// So the design already DEPENDS on `asOf` to disclose staleness. That disclosure never actually
// reached the reader: `get_vector_full_state` returns the raw state whose only time field is a
// bare ISO `asOf`, and `get_vector_pulse` served `as_of: state.asOf`. A model has no reliable
// "now" to subtract, and — worse — EVERY other Largo tool stamps `as_of` with `new Date()`, i.e.
// the moment the tool ran. A reader that has learned `as_of` means "when this was read" from the
// rest of the tool surface will read Vector's the same way and be wrong by up to 15 minutes.
//
// This is the same defect class as an OHLC bar carrying an epoch and nothing else: the number is
// present, its MEANING is not, and the consumer guesses. The fix is to ship the meaning alongside
// the timestamp — an explicit age, an explicit "now", and a named verdict — rather than to ship a
// timestamp and hope the arithmetic happens.

import { freshnessFromAgeMs, type BieFreshness } from "@/lib/bie/answer-envelope";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";

/**
 * How fresh a served Vector snapshot is. This is `BieFreshness` — the taxonomy that already
 * exists in `answer-envelope.ts` — NOT a parallel one.
 *
 * An earlier draft of this module defined its own live/recent/stale/unknown scale with a 6-minute
 * `recent` boundary, while `freshnessFromAgeMs` next door used 10 minutes. Same four words, two
 * different meanings, inside one product: a 7-minute-old Vector state was `recent` to
 * scenario-read's provenance and `stale` to this block. Reusing the classifier is the fix; adding
 * a third scale would have been the defect.
 */
export type VectorFreshness = BieFreshness;

/** Boundaries are `freshnessFromAgeMs`'s: live < 60s, recent < 10min, stale beyond. */
export const VECTOR_FRESHNESS_LIVE_SEC = 60;
export const VECTOR_FRESHNESS_RECENT_SEC = 10 * 60;

export type VectorFreshnessBlock = {
  /**
   * When the Vector state was MEASURED, as an ISO instant. Null if unparseable.
   *
   * Deliberately an ISO instant and NOT an ET stamp: the tool description relies on exact string
   * equality with `baseline_observed_at` to identify a re-served snapshot, and a minute-resolution
   * ET stamp would collide two genuinely distinct observations taken inside the same minute.
   */
  observed_at: string | null;
  /**
   * The ET trading session `observed_at` falls in — the MEASUREMENT's session, not the read's.
   *
   * `observed_at` has to stay a UTC instant (see above), which makes it exactly the kind of stamp
   * contract C1 exists for: after ~20:00 ET its calendar date is already tomorrow. Without this
   * field the block ships a pair that LOOKS self-contradicting — a snapshot measured 20:05 ET on
   * the 20th carries `observed_at: "...T00:05Z"` on the 21st beside `session_date: "2026-08-20"`,
   * and a model reconciling them has to guess which one to believe. Two labelled sessions that
   * genuinely differ are readable; one labelled session next to a bare instant is not.
   */
  observed_session_date: string | null;
  /** When this tool READ it, as an ET stamp — the market's clock, not UTC. */
  as_of: string | null;
  /** The ET session date of the READ (pairs with `as_of`; compare against `observed_session_date`
   *  to see whether the snapshot was measured in the session being asked about). */
  session_date: string | null;
  /** Whole seconds between measurement and read. Null when `observed_at` could not be parsed. */
  age_seconds: number | null;
  /** Named verdict so a reader never has to do ISO-8601 arithmetic to know what it is holding. */
  freshness: VectorFreshness;
  /** Plain-language disclosure to carry into an answer when the state is not live. */
  note: string | null;
};

/**
 * Describe how stale a served snapshot is. `observedAtIso` is the snapshot's `asOf`; `nowMs` is
 * the real current time (NOT derived from `asOf` — deriving it is what hid this in the first
 * place, since a frozen `asOf` then makes every read look instantaneous).
 */
export function describeVectorFreshness(
  observedAtIso: string | null | undefined,
  nowMs: number
): VectorFreshnessBlock {
  // ET, not UTC. A read at 20:30 ET on 2026-08-20 is `2026-08-21T00:30:00.000Z` in UTC, so anything
  // resolving a session from a UTC stamp lands a day ahead — the exact inversion that had Largo
  // date a live SPX figure to the next session and fabricate a close for the current one.
  const asOfEt = etStamp(nowMs);
  const sessionDate = etSessionDate(nowMs);
  const observedMs = observedAtIso ? Date.parse(observedAtIso) : NaN;

  if (!Number.isFinite(observedMs)) {
    return {
      observed_at: observedAtIso ?? null,
      // Unparseable as an instant means unparseable as a session too — null, never a fallback to
      // the read's session, which would silently relabel an unknown measurement as today's.
      observed_session_date: null,
      as_of: asOfEt,
      session_date: sessionDate,
      age_seconds: null,
      freshness: "unknown",
      // "We cannot tell how old this is" is a different answer from "it is fresh", and must never
      // be allowed to read as the latter.
      note: "This Vector state carries no readable measurement time, so its age is unknown — do not present it as live.",
    };
  }

  // A snapshot from the future means clock skew between the writer and this reader; clamp at 0
  // rather than reporting a negative age, which would read as "fresher than live".
  const ageSec = Math.max(0, Math.round((nowMs - observedMs) / 1000));
  // ONE classifier for the whole product — see the VectorFreshness doc above.
  const freshness: VectorFreshness = freshnessFromAgeMs(ageSec * 1000);

  return {
    observed_at: new Date(observedMs).toISOString(),
    // Derived from the MEASUREMENT instant, so it is right for a snapshot from any source — a v3
    // state that persisted its own `sessionDate`, an older cached entry that did not, or a state
    // handed in by a test. Same pure function of the same instant either way, never a guess.
    observed_session_date: etSessionDate(observedMs),
    as_of: asOfEt,
    session_date: sessionDate,
    age_seconds: ageSec,
    freshness,
    note:
      freshness === "stale"
        ? `This Vector state was measured ${formatAge(ageSec)} ago and has not refreshed since — say so rather than presenting it as the current tape.`
        : freshness === "recent"
          ? `This Vector state was measured ${formatAge(ageSec)} ago (within one refresh cycle).`
          : null,
  };
}

function formatAge(sec: number): string {
  if (sec < 90) return `${sec}s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m` : `${Math.round(min / 6) / 10}h`;
}

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
//
// A SECOND, NARROWER GAP (found 2026-09-20, raised repeatedly on #4076 as a cross-desk question
// before being scoped here): `freshness` above is a COMPUTE-recency verdict — "how long ago was
// this number calculated" — and says nothing about MARKET-SESSION recency — "does that calculation
// still describe a session the tape has moved in since". A weekend/holiday self-warm (any reader
// that misses the Redis cache re-runs `computeVectorFullState` on demand — see the module doc
// above) genuinely COMPUTES a fresh number *from* Friday's closing tape, so `describeVectorFreshness`
// correctly reports `freshness: "live"`, age ~0s — while the underlying market data is 40+ hours
// stale. Both readings are individually correct; a trader reading only `freshness: "live"` is
// misled into thinking a live tick backs the number.
//
// The fix is ADDITIVE, per the Largo product contract's own rule (`docs/audit/LARGO-PRODUCT-
// CONTRACT.md`: wrap, never flatten) — `market_session`/`market_session_note` sit ALONGSIDE
// `freshness`, they do not replace or reinterpret it. `freshness` still answers "how old is this
// compute"; the new fields answer the orthogonal question "is the market whose tape this compute
// describes currently open". A consumer that wants "can I trust this as the current tape" needs
// BOTH: `freshness !== "stale"` AND `market_session !== "CLOSED"`.
//
// Reuses `etSessionFacts` (`src/lib/et-session-facts.ts`) rather than inventing a fourth market-
// phase derivation — that module's own header explains why a fourth copy is exactly how two
// surfaces start disagreeing about the same minute; `market_session` here is a plain delegation to
// its holiday-aware `isTradingDayEt` composition, not a new implementation.

import { freshnessFromAgeMs, type BieFreshness } from "@/lib/bie/answer-envelope";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";
import { etSessionFacts, type MarketPhase } from "@/lib/et-session-facts";

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
  /**
   * MARKET-SESSION recency, orthogonal to `freshness` (see the module doc above). OPEN |
   * PRE-MARKET | AFTER-HOURS | CLOSED, evaluated at the READ instant (`nowMs`) — CLOSED on
   * weekends and market holidays, not just overnight. A compute can read `freshness: "live"`
   * (calculated moments ago) while `market_session` reads `CLOSED` (from a weekend/holiday
   * self-warm off Friday's tape); consumers that need "does this reflect a live tick" must check
   * both, never `freshness` alone.
   */
  market_session: MarketPhase;
  /**
   * Disclosure for exactly the misleading combination: compute is fresh (`freshness` is "live" or
   * "recent") but the market itself is shut, so the freshness verdict alone would overstate how
   * current the underlying tape is. Null whenever that combination does not apply — including when
   * `freshness` is already "stale"/"unknown" (that verdict's own note already covers it) or when
   * the market is genuinely open.
   */
  market_session_note: string | null;
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
  // Evaluated at the READ instant, same reasoning as `asOfEt`/`sessionDate` above: this is "is the
  // MARKET open right now", not a property of the snapshot being described.
  const marketSession = etSessionFacts(new Date(nowMs)).market_session;
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
      market_session: marketSession,
      // "unknown" already carries the strongest possible disclosure; a second note here would just
      // be noise on top of it.
      market_session_note: null,
    };
  }

  const rawAgeMs = nowMs - observedMs;
  // Beyond tolerance, a future stamp is clock skew — must not clamp to 0 and read as "live"
  // (same guard as FreshnessChip, admin-store-age, ageSecFromIso).
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) {
    return {
      observed_at: new Date(observedMs).toISOString(),
      observed_session_date: etSessionDate(observedMs),
      as_of: asOfEt,
      session_date: sessionDate,
      age_seconds: null,
      freshness: "unknown",
      note:
        "This Vector state's measurement time is ahead of the reader clock (clock skew) — do not present it as live.",
      market_session: marketSession,
      market_session_note: null,
    };
  }

  const ageSec = Math.max(0, Math.round(rawAgeMs / 1000));
  // ONE classifier for the whole product — see the VectorFreshness doc above.
  const freshness: VectorFreshness = freshnessFromAgeMs(ageSec * 1000);

  // The gap this block exists to close: a compute that is genuinely fresh (calculated moments ago,
  // possibly by a weekend/holiday self-warm) can still describe a market that has not ticked since
  // its last close. `freshness` alone cannot say so — it only ever saw the compute clock. Only fire
  // for the "live"/"recent" verdicts: a "stale" compute already carries its own, stronger note, and
  // piling a second disclosure on top of it would bury the more important one.
  const marketSessionNote =
    (freshness === "live" || freshness === "recent") && marketSession === "CLOSED"
      ? `Computed ${formatAge(ageSec)} ago, but the market is CLOSED as of this read — this reflects the last session's tape, not a live tick, however fresh the compute looks.`
      : null;

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
    market_session: marketSession,
    market_session_note: marketSessionNote,
  };
}

function formatAge(sec: number): string {
  if (sec < 90) return `${sec}s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m` : `${Math.round(min / 6) / 10}h`;
}

// src/lib/swing/brief-source-timeout.ts — bounded-timeout wrapper for OPTIONAL swing play-brief
// enrichment reads (play-brief-context.ts).
//
// WHY: play-brief-context.ts's `Promise.all` already treats a THROWN read as a degrade-to-null
// signal (see `ecosystemFetchFailed`/`vectorFetchFailed`) — but a read that never resolves at all
// (a wedged Redis hop, a slow cache-provider fallback) is a different failure mode: nothing throws,
// so `Promise.all` just hangs, and the whole brief compose blocks on ONE optional enrichment source
// that was never allowed to fail the request. The archetype/sub-lane track-record read
// (calibration-cache.ts, added alongside this file) is exactly that shape — a plain shared-cache
// GET that is best-effort by design (a cold/missing cache entry must not cost the brief anything) —
// so it is raced against a fixed budget here, same discipline as the Cortex per-source budget
// (`nighthawk/cortex/fetch.ts`'s `CORTEX_SOURCE_TIMEOUT_MS`/`withSourceTimeout`, 8s) but scoped to
// the swing brief's own optional reads so this module has no import edge into the Night Hawk lane.
//
// DEGRADE, NEVER THROW: unlike `withSourceTimeout` (which rejects on timeout so Cortex can COUNT the
// miss as an absent source), this wrapper resolves to `null` on either a timeout OR a rejection —
// the brief has no "absent source" ledger for this kind of soft enrichment, so a swallowed failure
// here must read as "no historical context to cite," never as a thrown brief.

/** Budget for one optional brief-enrichment read. Matches the Cortex per-source convention
 *  (8s) — long enough for a cold Redis hop, short enough that one slow read cannot noticeably
 *  regress the brief's own latency budget. */
export const BRIEF_SOURCE_TIMEOUT_MS = 8_000;

/**
 * Race an optional enrichment read against `ms` (default {@link BRIEF_SOURCE_TIMEOUT_MS}).
 * Resolves to `p`'s value on time; resolves to `null` on timeout OR on any rejection from `p` —
 * this wrapper is for READS that are already optional (a null/missing result is a normal, expected
 * outcome), so callers do not need a second `.catch()`.
 *
 * `p` itself is not cancelled on timeout (there is no cancellation primitive for an arbitrary
 * Promise) — it keeps running in the background and its eventual settlement is discarded. A late
 * resolution can therefore still warm whatever cache/memo `p`'s own source populates, even though
 * this call already moved on; a late REJECTION is not an unhandled-rejection risk either, since
 * `Promise.race` attaches its own handler to every promise passed to it, including the loser.
 */
export function withBriefSourceTimeout<T>(p: Promise<T>, ms: number = BRIEF_SOURCE_TIMEOUT_MS): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

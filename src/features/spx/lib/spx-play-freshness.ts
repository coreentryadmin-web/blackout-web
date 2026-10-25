/**
 * Pure freshness check for a peeked SPX play snapshot, extracted from spx-service.ts into its
 * own dependency-free file so it can be unit-tested with real assertions rather than only the
 * source-regex style the rest of spx-service.ts's tests use (that file pulls in db.ts/pg and a
 * long provider chain that isn't safe to import directly in a lightweight test).
 *
 * Used by peekSpxPlayState() to decide whether a peeked in-process or Redis-backed snapshot is
 * fresh enough to serve on the fast path for GET /api/market/spx/play, or whether it's stale
 * enough that the caller should fall through to a properly coordinated refresh instead. See that
 * function's own comment for the live-production bug this fixed (peekServerCache's generic
 * up-to-10-minute staleness tolerance being trusted as if it matched this route's 5s contract).
 */
export function isSpxPlaySnapshotFreshEnough(
  asOf: string | null | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!asOf) return false;
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) return false;
  return nowMs - asOfMs <= maxAgeMs;
}

/**
 * Cross-replica cache-sharing gate for a cached SPX play snapshot (added 2026-10-25, fixing a
 * same-day regression in PR #6719). `isSpxPlaySnapshotFreshEnough` above is correct for a
 * LIVE-MARKET snapshot, where `as_of` is a real evaluation-time stamp and staleness is a genuine
 * bug (the ~24-minute-stale, non-monotonic snapshots PR #6719 fixed). But
 * `evaluateSpxPlayCore`'s closed-market branch (spx-play-engine.ts) and the shared
 * `scanningPayload`/`degradedPlayPayload` builders (spx-play-payload.ts) all deliberately stamp
 * `as_of` from the DESK SNAPSHOT's own timestamp (`desk.polled_at ?? desk.as_of`) whenever
 * `session_phase === "closed"` — see `evaluateSpxPlayState`'s own comment in spx-service.ts:
 * "once the market is genuinely closed, 'stale' and 'correct' are the same thing... a generous
 * staleness ceiling is safe here specifically." A plain freshness bound can NEVER be satisfied
 * against that legitimately-old timestamp, so applying `isSpxPlaySnapshotFreshEnough` unconditionally
 * at the three cross-replica Redis-read sites in spx-service.ts (`waitForPeerSpxPlaySnapshot`,
 * `evaluateSpxPlayStateCrossReplica`'s lock-not-won branch, `spxPlayReadFallback`) rejected every
 * closed-market snapshot, every single poll — forcing a redundant re-evaluation on every contended
 * request instead of sharing the one already-published snapshot (defeating the "collapse member
 * polls into one eval per window" purpose those sites exist for), without fixing anything: the
 * re-evaluation reads the exact same (legitimately old) desk peek and produces an identical result.
 * `session_phase` is the discriminator already stamped on every `SpxPlayPayload` for exactly this
 * purpose — trust it here rather than re-deriving market-open state at the read site.
 */
export function isSpxPlaySnapshotShareable(
  value: { as_of?: string | null; session_phase?: string | null } | null | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!value) return false;
  if (value.session_phase === "closed") return true;
  return isSpxPlaySnapshotFreshEnough(value.as_of, nowMs, maxAgeMs);
}

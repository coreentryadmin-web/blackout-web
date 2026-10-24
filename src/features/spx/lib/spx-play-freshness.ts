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

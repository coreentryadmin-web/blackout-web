> **kind:** `FINDING`

## SPX Slayer — `GET /api/market/spx/play` served up to ~24-minute-stale, non-monotonic confluence snapshots because 3 of 4 cache read sites skip the freshness check the 4th enforces — FIXED

**Status.** FIXED (branch `fix/spx-play-cache-staleness-read-sites`).

| Field | Detail |
|---|---|
| **Area** | SPX Slayer play system — `src/features/spx/lib/spx-service.ts` |
| **Found by** | 5-engine live monitor workflow (Ask Largo standing mandate), live investigation + independent adversarial verification, 2026-10-25 |
| **Severity** | P1 (member-facing, divergent/flapping grade-score-direction on the live play card) |

### Symptom

Repeated authenticated `GET /api/market/spx/play` polls, spaced 8-90s apart, returned at least 4
distinct cached "generations" of the confluence result in non-monotonic order — a later poll
returning an OLDER `as_of` than an earlier poll (a direct backward jump), with two generations
carrying genuinely different `score`/`direction`/`factors` (10 factors / score 0 vs 2 factors /
score -11, direction short) for what should be the same market moment. One generation was
measured ~24 minutes stale — about 71x the route's own enforced 20-second freshness bound
(`playMemberPeekMaxAgeSec()`, default 20s). The sibling `GET /api/market/spx/desk` route, polled
in the same windows, behaved sanely (monotonic `polled_at`), so this was specific to `/play`'s
caching layer. Independently reproduced twice (initial investigation + adversarial verification
pass), both live, both matching generation fingerprints.

### Root cause

`spxPlayServerCacheKey(date)` (`server:spx-play-read:<date>`) is read from Redis at four call
sites in `spx-service.ts`. The fourth, `peekSpxPlayState()`, already bounds the hit with
`isSpxPlaySnapshotFreshEnough(hit.value.as_of, Date.now(), maxAgeMs)` before trusting it (fixed
2026-09-13, for exactly this class of bug). The other three returned whatever
`sharedCacheGetWithTtl` found the instant it was non-null, with **no** freshness check at all,
trusting the Redis key's own TTL alone:

- `waitForPeerSpxPlaySnapshot` (polls for a peer replica's published snapshot)
- `evaluateSpxPlayStateCrossReplica`'s lock-not-won branch (serves the shared key when another
  replica holds the cross-replica eval lock)
- `spxPlayReadFallback` (the `fallback` passed to `withServerCache` in `getSpxPlayState()`)

`evaluateSpxPlayStateCrossReplica`'s own code comment names exactly this failure mode as the
reason the cross-replica lock exists ("parallel cache misses on different replicas can return
divergent grade/score/direction") — these three unguarded reads reopened that same failure
through a different, still-unguarded path. Three closely-related staleness bugs on this exact
file were already found and fixed (2026-09-13, 2026-10-08 P1, 2026-10-16), but none of their
fixes reached these three call sites: they bypass `withServerCache`'s own generic caching and
read the shared Redis key directly inside their own function bodies.

### Blast radius

All three fixed call sites feed `GET /api/market/spx/play`'s "lock not won" / "peer wait" /
"`withServerCache` fallback-on-timeout" paths — exactly the paths exercised whenever the
cross-replica lock is contended or the fresh eval doesn't finish within `maxBlockMs`, which the
existing 2026-10-08 fix's own comment says is a routine outcome, not a rare one (in-process TTL is
only 5s). Same shared `spx-play-read:<date>` cache entry read by every caller of
`getSpxPlayState()`/`evaluateSpxPlayStateCrossReplica()` (member reads, BIE `spx_full_state`,
Largo `get_spx_play`) — all three consumers were exposed to the same stale/divergent data.

### Fix

Added the identical `isSpxPlaySnapshotFreshEnough(value.as_of, Date.now(), maxAgeMs)` guard
(`maxAgeMs = playMemberPeekMaxAgeSec() * 1000`, the route's own established freshness contract) at
all three previously-unguarded read sites, matching what `peekSpxPlayState()` already does. A
too-stale hit now falls through to the next step in each chain (peer-wait, then degraded) instead
of being trusted outright — the same fallback behavior that already existed for a cache miss.

### Tests

New `src/features/spx/lib/spx-service-play-cache-staleness.test.ts` (2 cases, using the same
`mock.module` harness as the existing `spx-service-cross-replica-lock.test.ts`):
- A 24-minute-stale cached snapshot (the live-reproduced magnitude) is rejected by
  `evaluateSpxPlayStateCrossReplica`'s lock-not-won branch, not served.
- A genuinely fresh (5s-old) cached snapshot is still served — no regression on the working case.

RED→GREEN confirmed via `git stash` (reverted `spx-service.ts` alone): 1/2 new assertions fail
pre-fix (the stale-rejection case) exactly as expected, 2/2 pass post-fix. `npx tsc --noEmit`
clean. Full existing suite for this file (`spx-service-cross-replica-lock.test.ts`,
`spx-play-freshness.test.ts`) still 10/10 pass together.

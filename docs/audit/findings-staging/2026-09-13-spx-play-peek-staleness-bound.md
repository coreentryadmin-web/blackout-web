> **kind:** FINDING

## SPX `/api/market/spx/play`'s fast-path peek served up to ~234s-stale snapshots, `as_of` jumping backward between polls — fix/spx-play-peek-staleness-bound — 2026-09-13

- **What was broken (found by a parallel audit workflow's SPX health-check lane, live 2026-09-13):**
  `GET /api/market/spx/play` polled at ~1s intervals in production returned snapshots up to ~234s
  stale, with the payload's own `as_of` timestamp jumping **backward** between consecutive requests
  and `assessed`/`score` flapping `true`/`39` ↔ `false`/`0` a second apart on the same poll loop —
  not a data-provider issue, a caching bug in the route's own fast path.
- **Root cause:** `peekSpxPlayState()` (`src/features/spx/lib/spx-service.ts`) is the fast,
  non-blocking peek the route (`src/app/api/market/spx/play/route.ts`) tries before falling back to
  the properly-coordinated `getSpxPlayState()`. It checked both an in-process cache (`mem`, via
  `peekServerCache`) and a Redis-backed cache (`hit.value`, via `sharedCacheGetWithTtl`) and
  returned whichever was non-null **unconditionally** — trusting `peekServerCache`'s generic
  `MAX_STALE_AGE_MS` (`src/lib/server-cache.ts`, a flat 10-minute tolerance meant for arbitrary
  callers) as if it matched this specific route's real ~5s freshness contract
  (`playMemberReadCacheSec`). It never checked the snapshot's own age against that contract at all.
  Compounding it: `peekServerCache`'s backing `store` is a per-process `Map`, not shared across ECS
  replicas, so different replicas independently served their own up-to-10-minute-stale in-memory
  copy on the same poll loop — which is exactly the "as_of jumps backward" symptom (a member's next
  poll can land on a different, staler replica than the previous one).
- **What changed:** added a new dependency-free helper, `isSpxPlaySnapshotFreshEnough(asOf, nowMs,
  maxAgeMs)` (`src/features/spx/lib/spx-play-freshness.ts`) — fails closed on null/undefined/empty/
  unparseable `as_of`, inclusive at the exact bound, and deliberately does NOT reject a future
  `as_of` (clock skew is a different concern from staleness). Added
  `playMemberPeekMaxAgeSec()` to `src/features/spx/lib/spx-play-config.ts` (`SPX_PLAY_MEMBER_PEEK_MAX_AGE_SEC`,
  default 20s — a real multiple of the route's own ~5s TTL, not the generic 10-minute ceiling).
  `peekSpxPlayState()` now runs both the `mem` and `hit.value` results through this check before
  trusting either; a too-stale result falls through to `null`, and the route's own fallback
  (`getSpxPlayState()`, which does a properly cross-replica-coordinated refresh via
  `evaluateSpxPlayStateCrossReplica`/`sharedCacheSetNx`) takes over instead of silently serving
  stale data.
- **Blast radius:** `peekSpxPlayState()` has exactly one caller
  (`src/app/api/market/spx/play/route.ts`), confirmed by grep — no other route or BIE/Largo
  consumer reads this fast path, so the fix is fully contained. `getSpxPlayState()` itself
  (the awaited, cross-replica-coordinated path BIE/Largo also use) was already correct and is
  unchanged.
- **Fix rationale:** the pure freshness check was extracted into its own file rather than left
  inline in `spx-service.ts` so it could be unit-tested with real behavioral assertions —
  `spx-service.ts` pulls in `db.ts`/`pg` and a long provider chain that isn't safe to import
  directly in a lightweight test, which is why the rest of that file's tests use the source-regex
  style instead. A generic fix to `peekServerCache`'s own `MAX_STALE_AGE_MS` was deliberately NOT
  made — that tolerance may be correct for other callers with looser freshness needs; the fix is
  scoped to this route's specific contract instead.
- **Evidence:** `src/features/spx/lib/spx-play-freshness.test.ts` — 7 new behavioral tests
  (fresh-within-bound, exactly-at-bound inclusive, one-ms-past-bound rejected, the exact
  live-production ~234s-stale case rejected, null/undefined/empty `as_of` rejected fail-closed,
  unparseable `as_of` rejected fail-closed, future `as_of`/clock-skew still accepted). Added a
  wiring test to `src/features/spx/lib/spx-service.play.test.ts` asserting `peekSpxPlayState`
  calls `isSpxPlaySnapshotFreshEnough` on **both** the `mem` and `hit.value` paths (exactly 2 call
  sites) — RED→GREEN confirmed via `git stash` on `spx-service.ts`/`spx-play-config.ts` (the
  original unconditional `if (mem) return mem;` shape reproduced and failed the new wiring test,
  restoring the fix returned it to green). Full suite 14063/14063 pass (3 pre-existing skips,
  unrelated), `tsc --noEmit` clean.
- **Not attempted here:** making `peekServerCache`'s Map-based store cross-replica-consistent
  (that's what the awaited `getSpxPlayState()` fallback already exists for) — this fix only makes
  the fast peek honest about when it must NOT be trusted, it doesn't change the underlying
  per-process cache architecture.

| **Status** | Fixed — PR opened, CI pending |

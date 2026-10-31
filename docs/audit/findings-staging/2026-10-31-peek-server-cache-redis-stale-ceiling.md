> **kind:** `FINDING`

## `peekServerCache`'s Redis-hit branch ignored its own `maxStaleMs` ceiling — SPX desk/play `as_of` non-monotonic, up to ~13.5 minutes backward — FIXED

| | |
|---|---|
| **Severity** | P1 (member-facing SPX desk/play data correctness — stale GEX/price snapshots served as current, non-monotonic `as_of`) |
| **Surface** | `src/lib/server-cache.ts` (`peekServerCache`), consumed by `peekSpxDesk()`/`peekMergedSpxDesk()` (`src/features/spx/lib/spx-desk-loader.ts`) and every other `peekServerCache` caller |
| **Status** | FIXED |

### Root cause

`peekServerCache(key, { maxStaleMs })` exists specifically to apply a staleness ceiling before
handing a cached value back without invoking the loader — every caller passes a tightened
`maxStaleMs` (e.g. `deskPeekMaxAgeSec()` → 40s for the SPX desk/merged-desk keys) precisely so a
replica that has fallen materially behind never silently serves an ancient snapshot. The
local-cache-only fallback branch at the bottom of the function already enforced this correctly
(`if (hit && now - hit.refreshedAt <= maxStaleMs) return hit.value;`), but the Redis-hit branch a
few lines above it did not:

```ts
const redisHit = await readRedisCache<T>(key);
if (redisHit != null) {
  setStoreEntry(key, {
    value: redisHit.value,
    expiresAt: now + redisHit.remainingTtlSec * 1000,
    refreshedAt: now,                       // <-- re-stamped to "now" regardless of real age
  });
  return redisHit.value;                    // <-- returned unconditionally, no staleness check at all
}
```

`redisHit.remainingTtlSec` only reflects Redis's own expiry countdown for the key — it carries no
information about when the cached value was actually produced. A key written with a long `ttlMs`
can sit unrefreshed for most of that window while `TTL` still reports a healthy remaining time, so
a replica that happened to read an old-but-not-yet-expired Redis copy would serve it no matter how
stale, and then re-stamp its own local copy's `refreshedAt` to `now` — trusting that same stale
payload as "freshly verified" for a further full `maxStaleMs` window on top, on this replica,
regardless of what `maxStaleMs` the caller actually passed in.

### Evidence

Live reproduction, 2026-10-31, production, polling `GET /api/market/spx/desk` and
`GET /api/market/spx/play` 3-8s apart in the same session:

- `/api/market/spx/desk`: `as_of` went `11:28:04.915Z` (×5 cached) → `11:27:01.497Z` (63s OLDER
  despite being a LATER poll) → `11:15:42.214Z` (~11.3 minutes older still); `gex_age_ms` bounced
  `10373 → 16964 → 4862` non-monotonically.
- `/api/market/spx/play`, polled every 3s for 30s: the first 5 polls returned a degenerate closed
  state (`as_of 11:18:14.696Z, score:0, factors:[], assessed:false`), then polls 6-10 only ~13s
  later returned a completely different, substantively populated snapshot
  (`as_of 11:28:37.942Z, score:3`, 13 real factors, `assessed:true`, `play_idea` populated) — with
  nothing in the real market having changed (Saturday, market closed). Overall span: as_of jumping
  up to ~13.5 minutes backward across consecutive polls.

This matches exactly the gap in `peekServerCache`'s Redis-hit branch: regardless of the `maxStaleMs`
a caller passes (`peekSpxDesk()`/`peekMergedSpxDesk()` pass `deskPeekMaxAgeSec() * 1000`, 40s by
default), that branch never checked it against the payload's own age — only the new regression test
(below) proves the mechanism in isolation, since the live repro's exact upstream cause (which
specific long-`ttlMs` key fed the stale Redis copy) was not re-investigated per the task scope.

### Fix

Added `readRedisGeneratedAt(key)` (`server-cache.ts`), which reads the generation timestamp
`writeRedisCache` already stores alongside every Redis-cached value (`server-gen:<key>` —
`generatedAt`, the wall-clock time that value's own refresh *started*, the same metadata the
cross-replica generation guard uses to prevent clobbers). `peekServerCache`'s Redis-hit branch now
checks `now - generatedAt > maxStaleMs` before caching/serving the value: too old → fall through to
the local-hit/`null` paths (the same "go compute fresh" signal every caller already treats a
too-stale local hit as), otherwise serve it and stamp the local copy's `refreshedAt` to the real
`generatedAt` (not `now`) so this replica's own later peeks don't restart the staleness clock from
the copy time.

When the generation metadata is absent (a replica mid-rollout on pre-generation-guard code, or a
Redis timeout on that specific read), age is unknown, and the fix deliberately falls back to the
pre-fix (trusting) behavior rather than rejecting a value with no actual evidence it is stale —
covered by its own regression test below.

### Blast radius

`peekServerCache` is also called by `peekSpxPlayState()` (`spx-service.ts`), `nighthawk/edition`,
`spx-desk-loader.ts`'s `peekSpxDesk`/`peekMergedSpxDesk`, `flows-member-cache.ts`, and
`flow-brief/route.ts`. All of these benefit from the same fix with no code change on their end —
the ceiling they already pass as `maxStaleMs` (or the generic `MAX_STALE_AGE_MS` default) now
actually applies to a Redis-sourced hit, not just a local-only one. `withServerCache`'s own
Redis-hit branches (a separate function, used by the blocking/SWR loader paths) were intentionally
left untouched — out of scope for this fix, which targets only `peekServerCache` per its own
already-inconsistent ceiling enforcement.

### Fix rationale

The ceiling needed to be checked against the payload's real vintage, not against when this replica
happened to observe it — exactly the asymmetry the local-only fallback branch already modeled via
`refreshedAt`. The generation timestamp `writeRedisCache` already writes for the cross-replica
clobber guard is the one piece of metadata that actually encodes that vintage, so reusing it (rather
than inventing a new sidecar key, or trying to infer age from `remainingTtlSec` and an unknown
original `ttlMs`) keeps the fix minimal and consistent with the existing generation-guard mechanism.
Falling back to "trust it" when the metadata is missing avoids over-correcting into rejecting
values this function has no actual evidence are stale — the same mid-rollout-compatibility posture
`writeRedisCache`'s own generation guard already takes.

### Tests

`src/lib/server-cache-peek-redis-staleness.test.ts` (new, 3 tests), using the same `./make-redis`
mocking approach as `server-cache-redis-generation.test.ts`:

- `peekServerCache refuses a Redis-cached value whose generation is older than maxStaleMs` — seeds
  Redis (via the real `writeRedisCache`) with a value generated 5 minutes ago under a 30-minute
  `ttlMs` (so Redis's own remaining TTL is still healthy), then asserts `peekServerCache(key, {
  maxStaleMs: 40_000 })` returns `null` instead of the stale value.
- `peekServerCache still serves a genuinely fresh Redis-cached value` — same setup with a 1-second-
  old generation, asserts the value is still served normally (no over-correction).
- `peekServerCache trusts a Redis hit with no generation metadata (mid-rollout compatibility)` —
  writes `server:<key>` directly (bypassing `writeRedisCache`, so no `server-gen:<key>` exists),
  asserts the value is still served (age unknown ≠ treated as stale).

RED→GREEN confirmed: with the source fix reverted (original `peekServerCache`, verified via `git
show HEAD:src/lib/server-cache.ts`), the first test fails (`actual: {as_of:..., label:'stale'}`
where `null` was expected); the other two already passed pre-fix (they don't exercise the bug).
With the fix restored, all 3 pass, alongside the full existing `server-cache.test.ts` (22/22) and
`server-cache-redis-generation.test.ts` suites, plus the SPX desk/play test files
(`spx-service.play.test.ts`, `spx-service-merged-desk-bg-refresh.test.ts`,
`spx-service-play-cache-staleness.test.ts`, `spx-desk-peek-staleness.test.ts`,
`spx-desk-loader-stale-ceiling.test.ts`). Full repo `npx tsc --noEmit` clean on Node 20.

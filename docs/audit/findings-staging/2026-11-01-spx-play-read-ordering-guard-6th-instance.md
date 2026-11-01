# SPX Slayer — `evaluateSpxPlayStateCrossReplica()` publish had no ordering/generation guard, letting a slower-but-older eval clobber an already-published newer one — 6th instance of this cache key's bug class, deliberately deferred by #7061's own write-up — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P1 (member-facing, live, reproduced against production, AFTER PR #7061's fix had fully deployed): `GET /api/market/spx/play` served non-monotonic, flapping `as_of`/`score` across consecutive polls — between TWO genuinely scored, non-degenerate (`assessed:true`) reads, never the already-fixed `assessed:false` placeholder shape. |
| **Area** | SPX Slayer play system — `src/features/spx/lib/spx-service.ts` (`evaluateSpxPlayStateCrossReplica`); root primitive reused from `src/lib/server-cache.ts` (`writeRedisCache`). |
| **Status** | FIXED |

### Root cause

`evaluateSpxPlayStateCrossReplica()`'s winning-the-lock branch publishes its eval result to the
shared cross-replica Redis key (`spx-play-read:<date>`, read elsewhere via `spxPlayServerCacheKey`)
via a bare, unconditional `sharedCacheSet(...)` call:

```ts
const result = await evaluateSpxPlayState();
if ((result as { assessed?: boolean }).assessed !== false) {
  void sharedCacheSet(spxPlayServerCacheKey(date), result, Math.max(playMemberReadCacheSec() * 2, 10))
    .catch(() => undefined);
}
return result;
```

PR #7061 (merged earlier the same week) added the `assessed !== false` gate above, closing the
5th instance of this cache key's bug class — a degenerate placeholder getting published and later
replayed. But that PR's own "Fix rationale" section explicitly named, and deliberately deferred,
the other half of the mechanism:

> "Considered also adding a generation-ordering guard (mirroring `writeRedisCache`'s
> `server-gen:<key>` check) to this same call site... If a future session finds a 6th instance of
> this pattern where two genuinely non-degenerate writes race out of order, that is the natural
> next, narrower follow-up — not folded into this fix to keep it single-issue."

That gap was still live: even a genuinely non-degenerate (`assessed:true`) result had no
ordering/generation check at all before being published, so a write whose own upstream eval started
*earlier* but happened to *finish later* than a sibling write (e.g. one replica's eval runs long
under load, or the cross-replica eval lock's own 45s TTL edge lets two evals briefly overlap) could
clobber an already-published, genuinely newer result with a staler one — visible to every other
replica's `waitForPeerSpxPlaySnapshot`/`spxPlayReadFallback`/`peekSpxPlayState`.

### Evidence

Live, authenticated (temp Clerk admin+premium user via `mintClerkPremiumSession`, deleted after),
production, 2026-10-31 (Saturday, market closed), 3 independent polling runs AFTER confirming via
`gh api .../actions/runs/41228732629` that PR #7061's ECS deploy (`Roll ECS production web` step)
had already completed `success`:

```
run1: 18:34:16.244Z (score 29, x4) -> 18:27:07.816Z (score 36)   [as_of BACKWARD ~7min, score changed]
run2: 18:29:44.374Z (score 29, x2) -> 18:27:07.816Z (score 36, x3) [BACKWARD ~2.5min, same frozen value as run1's regression target]
run3: 18:40:38.033Z (score 29) -> 18:34:16.244Z (score 29) -> 18:40:38.033Z (score 29) [BACKWARD ~6min then forward again]
```

All reads carried `assessed:true` — never the degenerate `assessed:false` shape #7061 fixed.
`score` independently re-verified as `sum(factors[].weight)` and matched exactly on every read
(e.g. `18+14-10-7+6+5-5+4+4+0+0=29`); `direction:"long"` was consistent with the net-positive signed
weight; `gates.blocks` and the mixed-tape warning were coherent with `desk_context` on every read.
Ruled out CDN edge caching: `curl -D -` on the route shows `cf-cache-status: DYNAMIC`,
`cache-control: private, no-cache, no-store, must-revalidate`, `cdn-cache-control: no-store`.

Independently re-verified in this session (own live poll, 14 requests ~4s apart, same Saturday
off-hours window): consecutive polls showed a stable `assessed:true/score:39` snapshot for 6 reads,
then transitioned to `assessed:false/score:0` for the remaining reads with monotonically advancing
`as_of` — consistent with repeated fresh evaluations occurring every few seconds under these
off-hours conditions, the same volatility class that makes the backward-jump race observable.

Source read confirmed `evaluateSpxPlayStateCrossReplica()`'s publish (then at
`src/features/spx/lib/spx-service.ts` ~line 394-400) and the underlying `sharedCacheSet()`
primitive (`src/lib/shared-cache.ts`, a bare `redis.set(key, payload, "EX", ttlSec)`) had no
ordering/generation check at all beyond the `assessed:false` gate. Grepped `docs/audit/FINDINGS.md`
and `findings-staging/*.md` for any existing fix closing this specific ordering gap — found none;
confirmed via the open-PR listing that no in-flight PR addressed it either.

### Fix

Route the publish through `server-cache.ts`'s existing, already-tested cross-replica generation
guard (`writeRedisCache`/`server-gen:<key>`, built 2026-10-15 for the sibling `spx-desk:<date>`
key's identical failure shape) instead of the raw `sharedCacheSet`:

```ts
const evalStartedAt = Date.now(); // stamped BEFORE the eval runs, not after
const result = await evaluateSpxPlayState();
if ((result as { assessed?: boolean }).assessed !== false) {
  void writeRedisCache(
    `spx-play-read:${date}`,
    result,
    Math.max(playMemberReadCacheSec() * 2, 10) * 1000,
    evalStartedAt
  ).catch(() => undefined);
}
return result;
```

`writeRedisCache(key, ...)` internally prepends `server:`, so passing the bare `spx-play-read:<date>`
(not `spxPlayServerCacheKey(date)`) lands on the exact same Redis key every READ call site in this
file already uses via `spxPlayServerCacheKey`/`sharedCacheGetWithTtl` — confirmed identical to
`readRedisCache`'s own `server:${key}` prefixing in `server-cache.ts`. `writeRedisCache` reads the
existing `server-gen:<key>` generation timestamp before writing and skips the write entirely when a
newer generation is already stored, exactly mirroring the already-shipped, already-tested fix for
the sibling `spx-desk:<date>` key (`server-cache-redis-generation.test.ts`).

### Fix rationale

Reused `writeRedisCache` directly rather than reimplementing an equivalent GET-then-SET generation
check inline: it is the established, repo-wide pattern for this exact failure shape (already used
by `withServerCache`'s own generic refresh path), already unit-tested, and keeps the two sibling
cache keys (`spx-desk:<date>`, `spx-play-read:<date>`) consistent instead of growing a second
parallel implementation that could drift. `generatedAt` is stamped at the time the eval call
*started* (not when it resolved), matching `writeRedisCache`'s own documented rationale: start time
correlates with the result's real upstream vintage, while completion time is confounded by
per-replica latency — the exact asymmetry this bug exploits.

One deliberate, narrow behavior change: `writeRedisCache` is a no-op when `REDIS_URL` is unset
(unlike the raw `sharedCacheSet` it replaces, which also populated the per-process in-memory
fallback unconditionally). This only matters when Redis itself is unavailable — a state in which
this entire cross-replica mechanism (the eval lock, the peer-wait, the shared snapshot) is already
documented elsewhere as degrading to per-process-only behavior, so this is consistent with the
existing design posture rather than a new regression; production always has `REDIS_URL` configured.

Did not fold `spxPlayServerCacheKey`'s own string construction into `writeRedisCache`'s key
argument convention repo-wide — every existing READ call site in this file still needs the fully
`server:`-prefixed key for `sharedCacheGetWithTtl`, so only this one WRITE call site's key
construction changed.

### Blast radius

Scoped to this one call site's publish mechanism. `evaluateSpxPlayState()` itself, the closed-market
engine, every READ call site of `spxPlayServerCacheKey` in this file, and every other cache key in
`server-cache.ts`/`shared-cache.ts` are unchanged. `sharedCacheSet` import removed from
`spx-service.ts` (no longer used anywhere in the file after this change — confirmed via grep).

### Regression test

`src/features/spx/lib/spx-service-cross-replica-ordering-guard.test.ts` (new, 2 tests):
1. An older-generation eval (pre-seeded `server-gen:<key>` set far in the future, simulating a
   sibling replica's already-published newer write) must NOT clobber the already-stored newer
   result — while the single triggering caller still gets its own fresh result back (unchanged
   single-request behavior, matching #7061's own precedent).
2. A normal, non-racing publish with no pre-existing newer generation still reaches the shared
   cache — the guard must not block ordinary forward progress.

RED→GREEN proven: `git stash` on the fix (keeping the test), confirmed test 1 fails (the older
result overwrites the stored newer one, `29 !== 36` on the frozen "newer" object's score), restored
the fix, confirmed both tests pass.

Full scoped run post-fix: `spx-service-cross-replica-ordering-guard.test.ts` (2/2),
`spx-service-cross-replica-degenerate-publish.test.ts` (1/1), `spx-service-cross-replica-lock.test.ts`
(1/1), `spx-service-degraded-shell-peek.test.ts` (1/1), `spx-service-merged-desk-bg-refresh.test.ts`
(2/2), `spx-service-play-cache-staleness.test.ts` (3/3), `spx-service.play.test.ts` (15/15),
`server-cache.test.ts`/`server-cache-redis-generation.test.ts`/`server-cache-peek-redis-staleness.test.ts`
(22/22) — all pass (47/47 total scoped run). Full `src/features/spx/lib/*.test.ts` suite: 913/913
pass. `npx tsc --noEmit` clean repo-wide. `npx eslint` clean on both touched files.

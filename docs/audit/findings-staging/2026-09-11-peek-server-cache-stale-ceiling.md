> **kind:** FINDING

## `peekServerCache` had no staleness ceiling — could serve arbitrarily old cached data forever — FIXED

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Severity** | P2 — member-visible, cross-replica-dependent, no error surfaced |
| **Found** | 2026-09-11, standing 5-engine live monitor + Ask Largo mandate cycle |
| **Files** | `src/lib/server-cache.ts` (`peekServerCache`), regression in `src/lib/server-cache.test.ts` |

### Root cause

`withServerCache` enforces `MAX_STALE_AGE_MS` (10 minutes) on its own stale-while-revalidate
fallback (the "FIX 5a" block) — an entry older than that is refused and a fresh blocking
compute is forced instead. `peekServerCache` (the sibling function used by every "instant read,
fire a background refresh" route) had **no such ceiling**: its final fallback was simply

```ts
if (hit) return hit.value;
return null;
```

with no check on `hit.refreshedAt` at all. Combined with two other facts already true of this
cache layer, this was live and reproducible, not theoretical:

1. `store` is a **per-process** in-memory `Map` — one independent copy per ECS replica, not
   shared.
2. `writeRedisCache` sets the Redis copy's TTL to the **same short `ttlMs`** as the in-memory
   entry (5s for `spx-play-read`) — so the Redis backstop expires within seconds of the last
   write from *any* replica.

Put together: a replica that goes a few minutes without serving traffic has nothing to refresh
its own local entry, and once ~5s pass with no write from ANY replica, Redis has nothing newer
either. The old `peekServerCache` then happily returned that replica's own stale local entry —
no matter how old — to the very next request routed to it, with the `as_of` field inside the
payload being the only honest signal anything was wrong.

### Evidence (live, 2026-09-11, `GET /api/market/spx/play`)

Three consecutive polls from the SAME authenticated client (~4s apart), through the ALB's normal
round-robin:

```
iter 0  now=10:42:17.856Z  as_of=10:35:51.197Z  score=24  (≈6.5 min stale)
iter 1  now=10:42:25.560Z  as_of=10:42:25.578Z  score=0   (fresh — different replica)
iter 2  now=10:42:29.758Z  as_of=10:35:51.197Z  score=24  (back to the stale replica)
iter 3  now=10:42:35.480Z  as_of=10:42:35.488Z  score=0   (fresh again)
iter 4  now=10:42:39.609Z  as_of=10:34:20.673Z  score=10  (a THIRD, different stale value)
iter 5  now=10:42:43.724Z  as_of=10:42:40.420Z  score=0   (fresh)
```

Three distinct scores (24, 10, 0) served to the same polling client within 26 seconds, one of
them ~21 minutes stale by the time it was first observed earlier in the same session. This is
the SPX Slayer score/grade a member sees on the board — it would visibly flicker between
different values on every poll depending on which replica the ALB routed to, with no error or
degraded flag anywhere in the response.

### Blast radius

`peekServerCache` is used by the identical "peek first, fire background refresh, fall through to
a fresh compute only on a null peek" pattern in **five** places:

- `src/app/api/market/spx/play/route.ts` (via `peekSpxPlayState` in `spx-service.ts`) — confirmed
  live above.
- `src/app/api/market/nighthawk/edition/route.ts` — Night Hawk Legacy's edition read.
- `src/features/spx/lib/spx-desk-loader.ts` — the SPX desk snapshot.
- `src/lib/flows-member-cache.ts` — member flow feed.
- `src/app/api/market/flow-brief/route.ts` — flow brief (checks both a current and a previous
  key).

All five inherit the same fix without any change on their end, since none of them override the
default `maxStaleMs`.

### Fix

Applied the identical `MAX_STALE_AGE_MS` ceiling `withServerCache` already enforces to
`peekServerCache`'s final fallback, measured from the entry's own `refreshedAt` (not
`expiresAt` — an entry can be long past its TTL while still comfortably under the staleness
ceiling; those are deliberately different budgets already in use elsewhere in this file). Once a
locally-cached entry exceeds the ceiling and Redis has nothing newer, `peekServerCache` now
returns `null` instead of the stale value — which is not a new code path for callers: every one
of the five call sites above already has a "peek returned null → do a real (blocking or
degraded) fetch" fallback, because that is the documented cold-start path. The fix only narrows
the window during which stale data can be handed out via the fast/instant path; it does not
change any caller's contract.

`maxStaleMs` is an optional override (default `MAX_STALE_AGE_MS`) purely so the regression test
can exercise the ceiling without a real 10-minute wait — no production caller passes it, so
runtime behavior for every existing call site is: same fast path for anything under 10 minutes
old, and now a fallback to real computation (instead of silently serving 10+ minute-old data)
beyond that.

### Evidence the fix works

`src/lib/server-cache.test.ts` — new test
`"peekServerCache refuses to serve a locally-cached entry past its staleness ceiling"`.
RED (`git stash` the fix): the test's first assertion fails — the old code returns the stale
`{ n: 1 }` value instead of `null`. GREEN (fix restored): all three assertions pass. Full suite:
13716 pass / 0 fail on Node 20; `tsc --noEmit` clean.

### What was deliberately left unchanged

- Did not lower `MAX_STALE_AGE_MS` itself (10 minutes) — that's an existing, separately-reasoned
  constant shared with `withServerCache`; this fix only makes `peekServerCache` respect the same
  ceiling it already claims to share the cache store with.
- Did not touch the Redis TTL-matches-local-TTL design (`writeRedisCache(key, value, ttlMs)`
  using the same short `ttlMs`) — that's the correct behavior for a genuinely live 5s snapshot;
  the bug was specifically the *peek* path's missing ceiling, not the TTL choice itself.
- Did not change any of the five callers — none of them need to, since a `null` peek result was
  already the documented "go compute a fresh value" signal in every one of them.

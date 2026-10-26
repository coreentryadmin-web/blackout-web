> **kind:** FINDING

## SPX desk/merged-desk peek paths had no per-key staleness ceiling, letting replicas serve divergent, non-monotonic snapshots across consecutive member polls — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **PR** | (this branch) |

### Root cause

`peekSpxDesk()`/`peekMergedSpxDesk()` (`src/features/spx/lib/spx-desk-loader.ts`) are the
non-blocking "instant read" peeks `GET /api/market/spx/desk` and the SPX play-eval path
(`evaluateSpxPlayStateCrossReplica`/`spxPlayReadDegraded`, `spx-service.ts`) call first, before
falling through to a real, `maxBlockMs`-bounded load. Both called `peekServerCache()`
(`src/lib/server-cache.ts`) with **no per-key `maxStaleMs` override**, so both fell back to the
generic `MAX_STALE_AGE_MS` (10 minutes) — a backstop against truly unbounded staleness, not a real
freshness contract for this specific pair of keys.

The real contracts these keys actually need to satisfy are much tighter: `deskCacheTtlMs()` (the
desk/merged refresh cadence, 10s default) and, downstream, `playGexStaleMaxSec()`'s "Desk data
stale" play-gate (`spx-play-gates.ts`, 90s default) that reads whatever desk snapshot these peeks
hand back. Each ECS replica keeps its own in-process `store` Map (`server-cache.ts`); Redis backs
it with the SAME short TTL as the in-memory entry. Once that short TTL elapses fleet-wide with no
fresh write (a lull in traffic hitting this exact key on every replica), a replica whose own local
copy has gone stale has nothing fresher to pull from Redis either — and, before this fix, was free
to keep serving its own up-to-10-minute-old local copy indefinitely, with no mechanism to force a
real refresh (the peek path never invokes a loader; the *caller* is responsible for falling through
to one when the peek returns `null`).

This is a narrower recurrence of the identical bug class already fixed for the sibling
`spx-play-read` cache key (`playMemberPeekMaxAgeSec()`, 20s against a 5s TTL — PRs #4780/#4912/
#6085/#6719/#6743/#6822) — that fix tightened `peekSpxPlayState()`'s ceiling and matched
`getSpxPlayState()`'s own fast-lane bound to it, but never touched the DESK/merged-desk cache keys
that `evaluateSpxPlayState()` itself reads to compute the play's score/direction/gate verdicts.
Live RTH polling of `GET /api/market/spx/desk` and `GET /api/market/spx/play` from one session
showed `as_of` jumping backward and forward non-monotonically across consecutive ~35-40s polls,
`play.score` repeating an earlier poll's exact value on that poll's exact timestamp, and the hard
"Desk data stale (Ns)" gate block flickering on and off between polls with comparable or worse
measured desk ages going unblocked elsewhere — consistent with different replicas (or the same
replica at different lulls) answering from desk snapshots of very different vintage, all "fresh
enough" under the generic 10-minute ceiling even though one was well past the gate's own 90s bar.

### Fix

Added `deskPeekMaxAgeSec()` (`src/lib/providers/config.ts`, env-overridable via
`SPX_DESK_PEEK_MAX_AGE_SEC`, default 40s — 4x the desk/merged 10s TTL, the same ratio already used
for `playMemberPeekMaxAgeSec()`, and comfortably under the 90s gate threshold). Wired it as the
`maxStaleMs` passed to `peekServerCache()` in:
- `peekSpxDesk()` — previously called with no options at all.
- `peekMergedSpxDesk()` — previously passed the caller's `opts` through unconditionally; now
  defaults to `deskPeekMaxAgeSec()` when the caller passes no explicit `maxStaleMs`, while still
  honoring an explicit override unchanged (`spx-service.ts`'s deliberate 24h closed-market read,
  `peekMergedSpxDesk({ maxStaleMs: 24 * 60 * 60 * 1000 })`, is untouched by this change).

Once a replica's locally-cached desk/merged entry exceeds this tightened ceiling (and Redis has
nothing fresher either), the peek now returns `null` instead of the stale value, so the caller
falls through to its existing, already `maxBlockMs`-bounded real load (`loadSpxDesk()`/
`loadMergedSpxDesk()`) instead of silently disagreeing with a fresher peer for minutes at a time.

**Deliberately NOT changed:** `loadSpxDesk()`'s/`loadMergedSpxDesk()`'s own SWR `maxStaleAgeMs`
option (the blocking-loader path, not the peek path). `withServerCache`'s SWR branch
(`server-cache.ts`) falls through to an **unbounded** `refreshCache()` call (no `maxBlockMs` race)
once `staleAge > maxStaleAgeMs` on a not-yet-degraded key — tightening that ceiling for an
actively-SWR'd key like `spx-desk`/`spx-merged` would make that unbounded-block branch fire far
more often, reintroducing exactly the unbounded-block failure class PRs #5061/#5065/#6090 already
fixed elsewhere in this same file. Fixing that branch's own missing `maxBlockMs` race is a
separate, broader change to the shared cache layer, out of scope here. Also deliberately NOT
changed: the generic `MAX_STALE_AGE_MS` default, or the pulse/flow desk sub-lanes (not implicated
by the live evidence, and not named in scope).

### Evidence

New test `src/features/spx/lib/spx-desk-peek-staleness.test.ts` — exercises the real
`peekSpxDesk()`/`peekMergedSpxDesk()`/`peekServerCache()` code paths with a mocked
`deskPeekMaxAgeSec()` returning a tiny fractional-second ceiling, so the real staleness math is
proven with milliseconds of real wait instead of a real 40s one. RED on pre-fix code (both
assertions failed — the stale entry was served instead of self-invalidating); GREEN post-fix
(2/2), confirmed via `git stash` of the two source-file changes with the test left in place.

Full `src/features/spx/lib/**/*.test.ts` + `src/lib/server-cache.test.ts` suite (944 tests): pass,
0 failures, on Node 20. `tsc --noEmit` and `eslint` on the touched files: clean.

### Blast radius

- `peekSpxDesk()` — one caller, `GET /api/market/spx/desk` (`src/app/api/market/spx/desk/route.ts`).
- `peekMergedSpxDesk()`'s two DEFAULT-usage call sites — `GET /api/market/spx/play`'s
  `ServerCacheTimeoutError` catch branch, and `spx-service.ts`'s `spxPlayReadDegraded()` (both only
  use the peeked bundle to derive `session_phase` for an already-degraded/error payload — a `null`
  result here was already handled via `.catch(() => null)` before this change, so a peek that now
  self-invalidates slightly more often just omits that one field more often, never a new failure
  mode). The one EXPLICIT-override call site (`spx-service.ts`'s 24h off-hours closed-market read)
  is unaffected by design.
- No other consumer of `spx-desk:<date>`/`spx-merged:<date>` reads through these two peek
  functions; `loadSpxDesk()`/`loadMergedSpxDesk()`/`loadBootstrapBundle()` (and every route that
  calls them directly) are unchanged.

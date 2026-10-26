> **kind:** `FINDING`

## SPX desk loader-path (`loadSpxDesk()`/`loadMergedSpxDesk()`/`loadBootstrapBundle()`) had no staleness ceiling of its own, letting replicas fall back to a 10-minute default — 4th instance of this cache-key's staleness-ceiling bug class — FIXED

| | |
|---|---|
| **Severity** | P2 — no incorrect trading math, but a real, reproducible live incoherence: `GET /api/market/spx/desk`'s `as_of` measured 52.4s–76.0s stale across 10 consecutive live polls, with two confirmed backward jumps (an older `as_of` served after a newer one had already been served). Feeds `playGexStaleMaxSec()`'s 90s "Desk data stale" play-gate and every member-facing desk read. |
| **Surface** | `src/lib/server-cache.ts` (`withServerCache`'s SWR branch) and `src/features/spx/lib/spx-desk-loader.ts` (`loadSpxDesk()`, `loadMergedSpxDesk()`, `loadBootstrapBundle()`), `src/lib/providers/config.ts` (new `deskLoaderMaxStaleAgeMs()`) |
| **Status** | FIXED |

### Root cause

Two different code paths read the same SPX desk cache keys (`spx-desk:<date>`, `spx-merged:<date>`,
`spx-bootstrap:<date>`) with two different staleness ceilings, and only one was ever tightened:

- `peekSpxDesk()`/`peekMergedSpxDesk()` pass `maxStaleMs: deskPeekMaxAgeSec() * 1000` (40s) into
  `peekServerCache` — fixed in PR #6882.
- Their FALLBACK — `loadSpxDesk()`, `loadMergedSpxDesk()`, and `loadBootstrapBundle()` — are backed
  by `withServerCache` with **no `maxStaleAgeMs` override**, so they defaulted to
  `server-cache.ts`'s generic 10-minute `MAX_STALE_AGE_MS`. `providers/config.ts`'s own doc comment
  on `deskPeekMaxAgeSec()` explicitly flagged this exact gap as deliberately deferred (see "Why this
  wasn't a one-line fix" below for why).

`server-cache.ts`'s per-process module-level `store` Map means each ECS replica can independently
serve its own stale local snapshot (bounded only by the untouched 10-minute ceiling) once Redis's
own short TTL (`deskCacheTtlMs()`, 10s) also lapses. ALB round-robin across replicas with staggered
refresh timing produces exactly the observed symptom: sustained tens-of-seconds-to-minutes
staleness and non-monotonic `as_of` timestamps across polls.

**Live-reproduced** (10 polls, `GET /api/market/spx/desk`, production, pre-fix): `as_of` values
ranging 52.4s–76.0s stale, with two confirmed backward jumps.

### Why this wasn't a simple one-line fix — required order

Tightening the loader path's ceiling to 40s *without first* fixing a separate issue would have
created a new regression: `withServerCache`'s SWR branch (`staleAge > maxStaleAgeMs`, key
not-yet-degraded) had a fast-lane/cold-miss sibling branches that already race a refresh against
`opts.maxBlockMs` via `Promise.race` — but this ONE branch did `return refreshCache(...)` **fully
awaited, with no race at all**. Tightening the ceiling to 40s would have made this unbounded-block
branch fire far more often (every one of the three loader call sites already passes
`maxBlockMs: deskBootstrapMaxBlockMs()`), risking the same ALB tail-latency regression this codebase
already had to fix once (PR #5061/#5065, documented inline near `server-cache.ts`'s
`deskBootstrapMaxBlockMs()` comment).

**Fixed in the required order:**

1. **FIRST**: added a `Promise.race` against `opts.maxBlockMs` to the `staleAge > maxStaleAgeMs`
   SWR branch in `server-cache.ts`, mirroring the identical race pattern already used by the
   fast-lane and cold-start branches in the same function. `refreshCache()` registers its promise in
   the module's `inflight` map **before** returning, so the loser of the race keeps running in the
   background and still populates the cache/Redis on success — nothing is cancelled, only the
   caller stops waiting on it. On a race-loss, the branch now returns the stale `hit.value` (the
   same race-losing behavior every other `maxBlockMs` branch in this file already falls back to).
2. **THEN**: added `deskLoaderMaxStaleAgeMs()` (`providers/config.ts`) — deliberately derived from
   the SAME value as `deskPeekMaxAgeSec()` (same env var, `SPX_DESK_PEEK_MAX_AGE_SEC`, default 40s)
   so the peek ceiling and the loader ceiling can never drift apart again — and wired it as
   `maxStaleAgeMs` into all three loader call sites' `withServerCache` options.

### Evidence (tests)

**Step 1 (race guard), `src/lib/server-cache.test.ts`:** new test *"SWR branch (stale past
maxStaleAgeMs, not yet degraded) honors maxBlockMs — bounded, serves the stale value instead of
blocking unboundedly on a slow refresh"*. RED→GREEN proven via a scoped `git show HEAD:...` revert
(this sandbox's shared git-stash stack makes a bare `git stash` unsafe across concurrent
sessions/worktrees, per this repo's own environment notes): pre-fix, the test's own harness-timeout
(150ms) fired because the branch blocked on the full 500ms slow refresh regardless of its 20ms
`maxBlockMs`; post-fix, 16/16 `server-cache.test.ts` pass, bounded near 20ms.

**Step 2 (ceiling), `src/features/spx/lib/spx-desk-loader-stale-ceiling.test.ts`** (new file): new
test *"loadSpxDesk()/loadMergedSpxDesk()/loadBootstrapBundle() pass maxStaleAgeMs:
deskLoaderMaxStaleAgeMs() to withServerCache, instead of leaving it unset..."* — mocks
`withServerCache` itself to capture the real `opts` object each of the three loader call sites
passes, and asserts `opts.maxStaleAgeMs` equals the mocked `deskLoaderMaxStaleAgeMs()` return value
for all three. (A first attempt at this test used real timing instead of capturing opts and was a
**false positive**: without the ceiling wired in at all, a freshly-aged ~40ms-old entry never gets
anywhere near the un-tightened 10-minute default, so it silently takes the ordinary non-ceiling SWR
fast path in BOTH the pre-fix and post-fix code, passing either way and proving nothing — replaced
with the opts-capturing version below, which RED-failed correctly pre-fix:
`actual: undefined, expected: 40321`.) RED→GREEN proven the same `git show HEAD:...` way.

Full scoped run post-fix: `server-cache.test.ts` (16/16), `spx-desk-loader.test.ts` (1/1),
`spx-desk-loader-stale-ceiling.test.ts` (1/1), `spx-desk-peek-staleness.test.ts` (2/2) — 20/20 pass.
`npx tsc --noEmit` clean.

Two pre-existing test files that mock `providers/config` partially (`spx-signal-log-catalyst-
shadow.test.ts`, `spx-signal-log-macro-predictions.test.ts`, `spx-desk-peek-staleness.test.ts`) had
to add a `deskLoaderMaxStaleAgeMs` stub alongside their existing `deskBootstrapMaxBlockMs`/
`deskCacheTtlMs`/etc. stubs — `spx-desk-loader.ts` now imports this function eagerly at module load
(same as its sibling `maxBlockMs` constants), so any test mocking that module's config dependency
partially needs it stubbed too, or the module fails to even load. Confirmed all three pass after
adding the stub (13/13 combined for the two signal-log files, 2/2 for the peek-staleness file).

### Blast radius

- `server-cache.ts`'s SWR-branch race-guard fix changes the behavior of **every**
  `withServerCache`/`serverCache` caller repo-wide that combines SWR (default), a not-yet-degraded
  key, a stale age past `maxStaleAgeMs`, AND an explicit `opts.maxBlockMs` — previously such a
  caller blocked fully on the refresh; now it's bounded. A caller that does NOT pass `maxBlockMs`
  (the overwhelming majority of callers that never set `maxStaleAgeMs` either, since the generic
  10-minute default is rarely approached) is completely unaffected — the `if (maxBlock != null...)`
  guard falls through to the exact same `return refreshCache(...)` as before when no budget is
  configured.
- The ceiling-tightening (step 2) only touches the three named SPX desk loader call sites
  (`loadSpxDesk()`, `loadMergedSpxDesk()`, `loadBootstrapBundle()`) — `loadSpxDeskFlow()` and
  `loadSpxDeskPulse()` (via `flowCacheOpts`/`pulseCacheOpts`) are **deliberately untouched**, not in
  scope for this fix, and not implicated by the live evidence (which was specifically `/spx/desk`'s
  `as_of`, backed by the `spx-desk`/`spx-merged`/`spx-bootstrap` keys).

### Fix rationale

Reused `deskPeekMaxAgeSec()`'s existing value (same env var) for the loader ceiling rather than
inventing a second, independent one — a dedicated `SPX_DESK_LOADER_MAX_STALE_AGE_SEC` would just
reopen the exact drift risk this fix closes (the peek path got tightened once already while the
loader path was deferred; a second independently-tunable knob could silently diverge the same way
again). The generic `MAX_STALE_AGE_MS` default (10 minutes) for every OTHER `withServerCache` caller
is untouched — this is a narrow, SPX-desk-specific tightening, not a global policy change.

For the race guard, considered adding a brand-new timeout mechanism but instead copied the EXACT
`Promise.race` pattern already used twice elsewhere in the same function (the fast-lane branch and
the cold-start branch) — same `setTimeout`-resolves-"timeout"-sentinel shape, same
"`refreshCache()` already registers itself in `inflight` before returning" reasoning for why the
race-loser keeps running safely in the background. This keeps the file internally consistent rather
than adding a fourth, differently-shaped timeout idiom.

### Prior sibling instances of this same staleness-ceiling bug class (4th occurrence, same cache key)

This is the **4th** distinct staleness-ceiling bug found against the exact same SPX desk cache
key(s), per `docs/audit/FINDINGS.md`:

1. **2026-10-15/16** — cross-replica Redis last-writer-wins race in `withServerCache` (`as_of`
   reverting backward across consecutive polls) — fixed via a `server-gen:<key>` generation guard in
   `writeRedisCache`.
2. **PR #6822 (2026-10-26)** — the off-hours `peekMergedSpxDesk({ maxStaleMs: 24h })` shortcut in
   `evaluateSpxPlayState()` served a genuinely-stale pre-7am-ET overnight snapshot as if "closed
   market = stale is fine" still held; fixed with a bounded off-hours re-refresh interval.
3. **PR #6882 (2026-10-26)** — `peekSpxDesk()`/`peekMergedSpxDesk()`'s own default usage had no
   per-key ceiling at all, falling back to the generic 10-minute `MAX_STALE_AGE_MS`; fixed with
   `deskPeekMaxAgeSec()`.
4. **This finding** — the peek path's own FALLBACK (the blocking loaders) still had no ceiling,
   because tightening it safely required first fixing an unrelated unbounded-block gap in
   `server-cache.ts`'s SWR branch. Same cache key, same root shape (a second, unguarded path reading
   the identical cache with a looser bound than the one already fixed), different specific code
   path each time.

The recurring pattern across all four: this cache key has multiple independent read paths
(peek-fast / blocking-loader / cross-replica-write / off-hours-shortcut), and fixing staleness on
one path without auditing every OTHER path that reads the same underlying key leaves the bug class
alive just one call site over. A future session finding a FIFTH instance here should treat that as
confirmation this cache key needs a single, shared staleness-ceiling abstraction rather than
continuing to patch each read path individually — out of scope for this fix, noted for the next one.

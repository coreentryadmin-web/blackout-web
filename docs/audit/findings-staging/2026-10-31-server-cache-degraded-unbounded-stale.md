> **kind:** `FINDING`

## `withServerCache`'s "already degraded" SWR shortcut served a frozen stale snapshot UNCONDITIONALLY forever — 5th instance of the SPX desk cache key's staleness-ceiling bug class — FIXED

| | |
|---|---|
| **Severity** | P2 — no incorrect trading math, but a real, reproducible live incoherence on a member-facing read: `GET /api/market/spx/desk` served an `as_of` ~10.6 minutes stale, with a payload byte-identical to one served ~43s earlier, well past the desk cache's own ~40s `maxStaleAgeMs` ceiling. |
| **Surface** | `src/lib/server-cache.ts` (`withServerCache`'s SWR branch, the `degradedKeys.has(key)` shortcut) |
| **Status** | FIXED |

### Root cause

`withServerCache`'s SWR branch has two sub-paths once a hit's `staleAge` exceeds its configured
`maxStaleAgeMs`: a "not yet degraded" path (races a real refresh against `opts.maxBlockMs`, correct
and already fixed for this exact ceiling — see `docs/audit/FINDINGS.md`'s "4th instance" SPX desk
write-up) and an "already degraded" (3+ consecutive loader failures) shortcut:

```ts
if (degradedKeys.has(key) && hit) {
  console.warn(`[server-cache] ${key}: degraded upstream, serving stale (age ...) instead of blocking refresh`);
  refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
  return hit.value;
}
```

This returned `hit.value` **unconditionally** — no staleness check of any kind, not even the
per-key `maxStaleAgeMs` ceiling this same branch's sibling already respects. Once a key crosses
`FAILURE_THRESHOLD` (3) consecutive loader failures, `degradedKeys.add(key)` fires, and from that
point on **every subsequent request re-enters this exact unconditional early return** — serving the
same frozen `hit` forever, growing arbitrarily stale, for as long as the upstream keeps failing on
that one replica. A loader does not need to hang to trigger this: a *fast*, repeatedly-failing
upstream call (a broken credential or network path specific to one ECS task, say) is enough —
`inflight` clears after each failed attempt, so the next request re-enters this branch and takes
the same frozen value again.

This is the **5th** distinct staleness-ceiling bug against the SPX desk cache key(s)
(`spx-desk:<date>`/`spx-merged:<date>`/`spx-bootstrap:<date>`), but — unlike the first four, which
were each about a *missing or looser* ceiling on a given read path — this one is about an existing,
already-correct ceiling being **completely bypassed** once a key goes degraded. The bug is generic
to `withServerCache`, not SPX-desk-specific: any caller combining SWR, a configured
`maxStaleAgeMs`, and a persistently-failing loader was equally exposed. `docs/audit/FINDINGS.md`'s
own "4th instance" write-up named this exact branch's "no further ceiling check" as the specific
gap it deliberately deferred ("A future session finding a FIFTH instance here should treat that as
confirmation this cache key needs a single, shared staleness-ceiling abstraction").

### Evidence

Live-audit report (independently re-verified against current `main` before fixing, per the
standing issue-handling policy): 8 authenticated polls of `GET /api/market/spx/desk`, ~12-15s apart,
production, 2026-10-31 (Saturday, market closed; `cf-cache-status: DYNAMIC`,
`cache-control: no-store`, ruling out edge caching). One poll at `21:35:30.090Z` returned
`as_of=2026-10-31T21:34:43.872Z` (46s stale, normal). The very next poll, 15s later at
`21:35:45.215Z`, returned `as_of=2026-10-31T21:25:11.271Z` — ~9.5 minutes BACKWARD relative to the
immediately preceding poll, and byte-identical (same `gex_net`, `gex_walls`, `flow_0dte_*`
premiums) to a payload captured 43s earlier at `21:35:02.856Z`. Confirmed via
`git merge-base --is-ancestor` that PR #6989's `peekServerCache` Redis-hit generation-check fix
(a *different* bug, already fixed — see below) was already deployed to production before this
reproduction ran, ruling that mechanism out as the explanation.

Confirmed by reading the branch directly: before this fix, the "already degraded" shortcut had no
ceiling check of any kind — any staleAge, however large, was served. Added a regression test
(`src/lib/server-cache.test.ts`, "degraded key does not serve the same frozen stale value forever —
falls back once past the hard staleness ceiling") that drives a key through 3 consecutive loader
failures (each losing its `maxBlockMs` race, so no rejection ever reaches the caller — the live
incident's exact shape) to mark it degraded, then proves a subsequent call — once staleness ALSO
clears the new hard ceiling — prefers a configured `fallback` over the frozen hit. RED→GREEN
proven by swapping in the pre-fix file content from `origin/main` (this sandbox's shared git-stash
stack makes a bare `git stash` unsafe across concurrent sessions, per this repo's own environment
notes, so the swap used `git show origin/main:<path> > <path>` and a local backup copy instead):
pre-fix, the test failed with `actual: {n:1}, expected: {n:99}` (the exact frozen-value symptom);
post-fix, 17/17 `server-cache.test.ts` pass.

### Why this is NOT the same bug as PR #6989 or the "4th instance" fix

- PR #6989 fixed `peekServerCache`'s Redis-HIT branch trusting any Redis value unconditionally
  (missing a generation-timestamp staleness check). That is a *different* code path
  (`peekServerCache`, never invokes a loader) from this fix's `withServerCache` SWR branch (which
  does invoke the loader, via `refreshCache`).
- The "4th instance" fix (`docs/audit/FINDINGS.md`) added the `maxBlockMs` race to this SAME SWR
  branch's "not yet degraded" sibling, and tightened `deskLoaderMaxStaleAgeMs()` — but that fix's
  own text explicitly says a key that becomes degraded "falls back to returning the stale
  `hit.value` with no further ceiling check," naming exactly the gap this fix closes.
- Open PR #7081 (merged, unrelated: admin UW live-integration prefix matching) and PR #7068
  (merged, unrelated: `evaluateSpxPlayStateCrossReplica`'s publish-ordering guard, a different
  cache key's publish-side race, not this read-side shortcut) were checked and do not overlap this
  fix's surface.

### Fix

Once staleness ALSO clears a second, harder ceiling — `DEGRADED_HARD_STALE_MULTIPLIER` (3) times
the caller's own `maxStaleAgeMs` — stop returning the frozen `hit` unconditionally and prefer
`opts.fallback()` (bounded by `opts.maxBlockMs`, the same `Promise.race` idiom already used three
other times in this file) when one is configured. `spx-desk-loader.ts`'s `deskCacheOpts.fallback`
builds a desk shell from the independently-cached `pulse` lane, which is typically NOT degraded on
the same replica and gives a genuinely fresher (if less complete) response instead of the same
ancient snapshot. A caller with no fallback configured keeps today's exact behavior (nothing better
to serve); the branch still kicks a background refresh attempt either way, and a fallback that also
fails/times out falls through to the stale value rather than throwing — strictly never worse than
before this fix.

### Fix rationale

3x headroom beyond the primary ceiling preserves the branch's original intent (skip a doomed
blocking refresh on the common, brief-degradation case — avoiding the exact latency regression this
shortcut was built to prevent) while still bounding the worst case to a small, well-defined multiple
of the caller's own freshness contract instead of unboundedly. Reused the existing fallback-race
idiom verbatim (same shape as the "cold miss (inflight, fallback)" and "cold miss" throw sites
already in this file) rather than inventing a new timeout mechanism, per this file's own documented
preference for copying an established pattern over adding a fourth differently-shaped one.

### Blast radius

Only callers that are (a) SWR (default), (b) configure a loader that can genuinely degrade
(3+ consecutive failures), AND (c) have a hit whose staleness clears the new hard ceiling are
affected. For callers with a tightened `maxStaleAgeMs` (e.g. SPX desk's 40s), the hard ceiling is a
small, bounded multiple (120s) — comfortably under the observed ~10.6-minute incident. For callers
relying on the generic 10-minute default, the hard ceiling becomes 30 minutes — a behavior change
only in the rare case staleness grows beyond 30 minutes while also degraded, and strictly an
improvement (prefer a fresher fallback over 30+ minutes of frozen data) when it does apply. Checked
every other `withServerCache`/`serverCache` caller that configures both a `fallback` and relies on
SWR (`nighthawk/edition/route.ts`, `spx-service.ts`, `spx-desk-loader.ts`, `option-trades.ts`,
`polygon-options-gex.ts`, `flows-member-cache.ts`) and ran their test suites — all green, no
behavior change for the common path.

### Regression guard

New test in `src/lib/server-cache.test.ts` (see Evidence above). Full scoped run post-fix:
`server-cache.test.ts` (17/17), `spx-desk-loader.test.ts` + `spx-desk-loader-stale-ceiling.test.ts`
+ `spx-desk-peek-staleness.test.ts` + `spx-service.play.test.ts` (19/19 combined),
`nighthawk/edition/route.test.ts` + `flows-member-cache.test.ts` + `polygon-options-gex.test.ts`
(89/89 combined). `npx tsc --noEmit` clean. `npx eslint` clean on both touched files.

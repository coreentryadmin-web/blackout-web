> **kind:** FINDING

## `data-integrity-verifier.ts`'s `redis_ttl` check could never detect the one defect it claims to — FIXED

| **Status** | FIXED (`fix/redis-ttl-noexpiry-detection`) |
|---|---|

### Root cause

`src/lib/correctness/data-integrity-verifier.ts`'s `checkRedis()` carries a "raw TTL probe on the
gex-heatmap namespace" whose own detail text has always promised: *"-1 (no expiry) on a cache
that should expire is itself a smell (stale-as-live risk)"* and would render `"NO expiry set
(stale-as-live risk)"` when it saw a negative TTL.

That branch was dead code — structurally unreachable — because the probe was built on
`sharedCacheGetWithTtl()` (`src/lib/shared-cache.ts`), whose own implementation is:

```ts
if (raw && ttl > 0) {
  return { value: JSON.parse(raw) as T, remainingTtlSec: ttl };
}
// ...falls through to the (separate, same-process-only) in-memory map, else returns null
```

A Redis key that **exists with no expiry at all** (`TTL` command returns `-1`) fails the
`ttl > 0` gate exactly the same way a **genuinely absent** key (`TTL` returns `-2`) does. Both
states collapse to the function returning `null`, and the verifier's old code read that `null`
as a single case — "Raw TTL probe ... returned nothing (Redis miss → in-memory-only or cold)" —
with no way to tell the two apart. The `ttl < 0 ? "NO expiry set..." : ...` line later in the
same file could therefore never execute in production: `probe` (the `sharedCacheGetWithTtl`
result) is only ever non-null when its own internal gate already proved `ttl > 0`, or when the
in-memory fallback supplied a `remainingTtlSec` clamped to `>= 1` — so `ttl` was never negative
on any path that reached that line.

Confirmed by trace, not just inspection: added a fake-Redis unit test
(`src/lib/shared-cache.test.ts`) that sets a real `-1` TTL on a key with data present and shows
`sharedCacheGetWithTtl` returns `null` for it, identically to a key that is fully absent (`-2`).

### Why it wasn't caught earlier

This is the same **check-that-cannot-observe-its-own-failure-mode** bug class as the three prior
fixes this session (`largo-verifier.ts` self-consistency miscount, `nighthawk-verifier.ts`'s L4
premium check emitting "pass" on a gated-out comparison, `data-integrity-verifier.ts`'s own
`pg_editions` empty-table mislabel) — but one level more hidden: the earlier three emitted a
*false positive status* (`pass`/`consistency-only`) on a check that silently never ran. This one
emitted an honestly-labeled status (`consistency-only`/`skipped`) for the *wrong reason* in the
one case that mattered, because the shared helper it was built on had already discarded the
specific signal (`-1`) the check's own prose claims to act on. Nothing in CI or `tsc` can catch a
dead branch whose condition is merely *improbable through this API* rather than a type error —
it needed tracing the actual data flow through `sharedCacheGetWithTtl`'s gate to see.

A prior audit round (492) flagged this exact branch for a second look but declined to touch it,
reasoning the companion `redis_gex` checks (same key, via `getGexPositioning`) might already
cover a `null` probe. That reasoning holds for the **absent-key** case during RTH (confirmed:
`getGexPositioning`'s own cache-miss path triggers a real Polygon rebuild rather than returning
null, so in the fully-cold-cache case where that rebuild *also* fails, `redis_gex` already flags
SPX) — but it does **not** hold for the **no-expiry** case: `getGexPositioning` reads through
`sharedCacheGet` (no TTL gate at all), so a no-expiry key reads back perfectly healthy there,
leaving the no-expiry smell completely unobserved anywhere on this scorecard.

### Evidence (RED → GREEN)

- Added `sharedCacheRawTtlSec(key)` to `src/lib/shared-cache.ts` — a literal, unfiltered Redis
  `TTL` probe (never routed through `sharedCacheGetWithTtl`'s `ttl > 0` gate, never falls back to
  the in-memory mirror) so `-1` and `-2` are distinguishable states, not both `null`.
- Added a pure classifier `classifyRedisTtlProbe(rawTtlSec, rth)` in `data-integrity-verifier.ts`,
  exported for direct unit testing, that maps the 4 real states (`null` unreachable-Redis,
  `-2` absent, `-1` no-expiry, `N>0` bounded) to an honest outcome each — `-1` now **always**
  flags, RTH or not, since a permanently-live key is a defect in the key itself.
- `git stash` isolation: stashed only the two source files
  (`data-integrity-verifier.ts`, `shared-cache.ts`), kept the new tests — **10/20 tests failed**
  (`sharedCacheRawTtlSec is not a function`, `classifyRedisTtlProbe` undefined) confirming RED;
  `git stash pop` restored the fix — **20/20 pass**, confirming GREEN.
- Full `src/lib/correctness/*.test.ts` + `src/lib/shared-cache.test.ts` on Node 20: **113/113
  pass**. `npx tsc --noEmit`: clean.

### Blast radius

- `sharedCacheGetWithTtl` itself is **unchanged** — every other caller (`swing-discovery` route,
  `spx-service.ts` ×4, `relative-volume-source.ts`, `server-cache.ts`, `admin-cron-health.ts`)
  keeps its existing, correct "treat a non-positive TTL as a miss" semantics; none of those
  callers want a no-expiry key treated as live data, so that function's behavior is deliberately
  left as-is.
- The only call site changed is `data-integrity-verifier.ts`'s `redis_ttl` check itself — a new,
  additive export (`sharedCacheRawTtlSec`) was used in its place, so no other consumer is
  affected.
- Grepped for any other correctness-verifier TTL probe with the same shape
  (`sharedCacheGetWithTtl` used purely to assert a stored expiry, not to read a value) —
  none found; this is the only such use in the correctness-verifier surface.

### Fix rationale

Kept the fix additive and narrowly scoped to the one broken check rather than changing
`sharedCacheGetWithTtl`'s contract (high blast radius — 6+ production call sites depend on its
exact "miss on non-positive TTL" behavior for real caching logic, not diagnostics). The
`-2`/off-RTH handling for the genuinely-absent case was deliberately left as `consistency-only`
(RTH) / `skipped` (off-RTH), matching round 492's original, correct half of the reasoning — only
the `-1` no-expiry path (the half that was actually broken) changed to an unconditional `flag`.

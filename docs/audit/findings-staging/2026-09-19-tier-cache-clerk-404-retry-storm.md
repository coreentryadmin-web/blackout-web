## Shared tier cache re-hit Clerk's getUser every ~1s SSE tick for a userId Clerk permanently 404s on — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/tier-cache.ts` (`resolveUserTier`), shared by every tier-gated page/API and all three long-lived SSE streams (`market/vector/stream`, `market/zerodte/marks/stream`, `market/flows/stream`) |

### How found

Live CloudWatch Logs sweep (`/ecs/blackout-production`, DISCOVERY-lane hourly cycle, off-hours/
weekend), filtering the last hour for `ERROR`/`error`/`Error`: 30 matching lines, ~15 of them the
repeating three-line tail of a pretty-printed Clerk SDK error object (`clerkError: true`, `code:
'api_response_error'`, `errors: [Array]`). Pulling the full multi-line record (`get_log_events`
around the timestamp) showed the real message:

```
[tier-cache] Clerk getUser failed and no cached tier: a: Not Found
    ... at async f (.next/server/app/api/market/zerodte/marks/stream/route.js:1:7952)
  status: 404,
```

Widening the CloudWatch query to the full incident window found **126 identical occurrences
across 8 distinct ECS log streams (replicas) between 21:39:08 and 21:47:08 UTC** — an ~8-minute
burst that self-resolved once the underlying SSE connection(s) closed, at a rate of roughly one
failed Clerk `getUser` call per second, consistent with the 0DTE marks-stream route's `TICK_MS =
1_000` tick interval.

### Root cause

`resolveUserTier` (`tier-cache.ts`) is a 60-second success cache in front of Clerk's
`users.getUser` — its own doc comment explains it exists specifically because *"each [call site]
used to make a fresh clerkClient.users.getUser() call — a storm that hit Clerk's Backend API rate
limit."* That comment is correct for the **success** path (a valid, existing userId whose tier is
looked up repeatedly) — one Clerk call collapses to ~one per minute.

It does not hold for the **failure** path. On a Clerk `getUser` failure with no usable cached tier
(the exact case a hard 404 for a deleted/invalid `userId` produces — this is not a transient
"Clerk is down" blip, it will 404 identically on every subsequent call), `resolveUserTier` throws
`TierUnavailableError` and caches **nothing** — the next call, one tick later, repeats the exact
same doomed Clerk request. All three SSE stream routes call `recheckSseUserEntitlement` →
`resolveUserTier` inside a per-tick `send()` on a `setInterval(..., 1000)` (marks/vector) or on
every live flow event (flows route); when the verdict comes back `"unavailable"` the route just
`return`s for that tick and lets the interval fire again — so for the entire lifetime of a stale
SSE connection carrying such a `userId`, the app re-hits Clerk's Backend API roughly once per
second, per open connection, per replica — precisely the "storm" scenario the 60s cache exists to
prevent, just reached from the one code path that was never given a negative-result cache.

### Fix

Added a second, small, bounded Map (`tierFailCache`, same insertion-order LRU + capped-size
pattern already used by `tierCache` itself) holding `userId → last-failure timestamp`, with a
15-second backoff (`TIER_FAIL_BACKOFF_MS`, well under the 60s success TTL so a real Clerk recovery
is still felt fast). `resolveUserTier` checks it right after the existing fresh-cache check: a
recent failure short-circuits straight to the same stale-tier-or-throw decision a fresh Clerk
attempt would make (`staleTierOrUnavailable`, extracted from the existing catch-block logic so
both paths share one decision, not two copies), without ever calling Clerk again until the backoff
expires. A successful call clears the entry; `invalidateTierCache` (and therefore
`publishTierChanged`, called after a confirmed Whop/Clerk metadata update) also clears it, so an
explicit invalidation is never held back by a backoff it just armed. The backoff-skip path does
**not** log (the real attempt already logs once when the failure actually happens), so this also
cuts the matching CloudWatch log volume from ~1/sec to ~1/15s during such a burst — a small but
real side benefit given CloudWatch Logs ingestion cost scales with line count.

### Blast radius

One file changed (`src/lib/tier-cache.ts`). Every caller of `resolveUserTier` benefits uniformly
and automatically — `market-api-auth.ts`'s API tier gate, `auth-access.ts`'s page-render gate, and
`sse-stream-entitlement.ts`'s `recheckSseUserEntitlement` (and therefore all three SSE stream
routes) — with zero change to any caller's code or to the happy-path/first-failure behavior
(same return values, same first-failure log line, same `TierUnavailableError` type). Nothing else
touches `tierCache`/`tierFailCache` internals.

### Fix rationale

A short negative-cache is the minimal fix that matches the existing success-cache's own design
intent (bounded staleness, never silently over-grants access, degrades the same way to the
caller). Considered and rejected: backing off inside the SSE routes themselves instead (would need
duplicating the same logic three times, in three files, for a problem that is really about the
shared tier resolver, not about SSE specifically — `resolveUserTier` is also called from plain
page renders and REST API routes, which get the same benefit for free with a shared fix and would
not with a route-local one); a longer backoff (weighed against how fast a real Clerk recovery
should be felt — 15s keeps that fast while still cutting the per-second storm by ~15x).

### Evidence

**RED→GREEN**: new `src/lib/tier-cache-fail-backoff.test.ts` (3 tests, `node:test` +
`mock.module`, same harness as the existing `tier-cache-jwt-downgrade.test.ts`). Stashed the fix
and re-ran: the "repeated calls within the backoff window make exactly ONE Clerk call" test failed
(`expected: 1, actual: 6` — 6 real Clerk calls for 6 ticks, reproducing the storm). Restored the
fix: all 3 pass (1 Clerk call for 6 ticks; a fresh 60s cache hit still short-circuits before any
backoff check; `invalidateTierCache` clears the backoff so an explicit invalidation isn't held
back). Existing `tier-cache-freshness.test.ts` (3/3) and `tier-cache-jwt-downgrade.test.ts` (3/3)
still pass unchanged. `npx tsc --noEmit`: clean.

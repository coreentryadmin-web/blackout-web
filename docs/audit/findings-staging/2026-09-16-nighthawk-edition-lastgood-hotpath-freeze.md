## 2026-09-16 — [FINDING, FIXED] Night Hawk edition `lastGoodEdition` fallback froze at the process's first resolve, not its latest

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Lane** | Night Hawk Legacy |
| **File** | `src/app/api/market/nighthawk/edition/route.ts` |
| **PR** | (this branch) |

### Root cause

`GET /api/market/nighthawk/edition` keeps a module-level `lastGoodEdition` variable, documented in
its own comment block as "this process's own last successful read" — the value served when a
`maxBlockMs` (500ms) timeout fires mid-refresh, so a transient slow-DB hiccup reads as "temporarily
degraded" rather than a fabricated `available:false` empty shell (the exact bug #4599/#4961 already
fixed for the *shape* of that fallback).

The handler has two branches:
- **Fast path** (`if (instant)`, taken whenever `peekServerCache` finds an already-cached entry —
  which is nearly every request once the 60s in-memory/Redis cache is warm): fires a background
  `withServerCache(...)` refresh and immediately returns the cached value. The refresh's resolved
  value was discarded with a bare `.catch(() => undefined)`.
- **Cold-miss path** (`else`, taken only when nothing is cached anywhere — a true cold start, a
  post-eviction gap, or a real outage past the 10-minute SWR staleness ceiling): awaits
  `withServerCache(...)` directly and assigns the result to `lastGoodEdition`.

`lastGoodEdition` was therefore assigned **only** on the cold-miss branch. Under normal continuous
production traffic the fast path is what nearly every request takes once the cache is warm, so the
cold-miss branch — and with it, the only line that ever updated `lastGoodEdition` — runs once, early
in the process's life, and then effectively never again. The variable's real behavior was "this
process's *first* successful read," not its documented "last."

### Evidence

Traced `withServerCache`/`peekServerCache` in `src/lib/server-cache.ts`: `peekServerCache` serves a
stale-while-revalidate hit for up to `MAX_STALE_AGE_MS` (10 minutes) since the entry's last
successful refresh, and the underlying `store` gets refreshed by `withServerCache`'s own internal
`refreshCacheInBackground` roughly every TTL window (60s here, `nighthawkEditionCacheTtlMs()`) under
active polling. So once a replica has served one request past cold start, `peekServerCache` returns
non-null on essentially every subsequent request for the rest of that replica's life, routing 100% of
routine traffic through the fast path that never touched `lastGoodEdition`.

Confirmed via `grep`: exactly one assignment site for `lastGoodEdition` in the whole file (the
cold-miss branch), versus two read sites inside `timeoutFallbackEdition`.

### Blast radius

Single call site — `GET /api/market/nighthawk/edition` is the only consumer of `lastGoodEdition`.
No other route shares this module-level variable. `timeoutFallbackEdition`'s own cross-date
restamping logic (the 2026-09-14 fix) is unaffected and still applies to whatever value
`lastGoodEdition` now holds — this fix only changes *how fresh* that value is kept, not the
restamping contract around it.

### Fix rationale

Mirror the exact same guard the cold-miss branch already uses (`if (edition.available !== false)
lastGoodEdition = edition;`) onto the fast path's background refresh, via a `.then()` chained before
the existing `.catch(() => undefined)`. This keeps `lastGoodEdition` current on every request that
actually causes a real refresh (background SWR refresh cycles roughly every TTL window under
traffic), so a `maxBlockMs` timeout — however rare — replays a snapshot that is at most one refresh
cycle old instead of one that can be hours or days stale (frozen since replica boot). The same
`available !== false` guard means a background call that itself hits `timeoutFallbackEdition`'s own
degraded-empty-shell fallback cannot corrupt `lastGoodEdition` with an empty shell — it's naturally
skipped by the existing guard.

Considered and rejected: restructuring the cache layer itself (e.g., exposing the underlying
`store` entry's `refreshedAt` to the route) — much larger surface change to a shared, heavily-used
cache utility for no added benefit over this two-line, single-file fix.

### Regression test

`src/app/api/market/nighthawk/edition/route.test.ts` — new test asserts the `if (instant)` block's
source contains the `.then((edition) => { if (edition.available !== false) lastGoodEdition =
edition; })` chain. RED→GREEN proven: reverting the route change alone produced 10 pass / 1 fail;
restoring it produced 11/11 pass.

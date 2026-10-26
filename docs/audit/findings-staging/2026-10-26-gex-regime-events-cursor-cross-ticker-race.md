> **kind:** `FINDING`

## GEX regime-transition durable-history cursor (`persistGexRegimeEvents`) had an unlocked, cross-ticker read-modify-write — concurrent builds for different tickers could cause duplicate durable rows — FIXED

| | |
|---|---|
| **Severity** | P3 (shared mutable state race — inflates a durable analytics/history log with duplicate rows; no member-facing data corruption, no spend/safety impact) |
| **Surface** | `src/lib/providers/gex-regime-events.ts` — `persistGexRegimeEvents`, the fire-and-forget durable-history writer called from `polygon-options-gex.ts`'s `fetchGexHeatmap` on every fresh (cache-miss) GEX matrix build |
| **Status** | FIXED |

### Root cause

`persistGexRegimeEvents(ticker, events)` did an unlocked, multi-round-trip read-modify-write
against a single Postgres key-value row (`platform_meta` key `gex_regime_event_cursor`):

```ts
const cursor = await loadCursor(today);      // SELECT (one GLOBAL JSON blob, all tickers)
// ...diff events against cursor, decide what's "new"...
// ...insert the "new" rows into gex_regime_events...
await saveCursor(today, cursor);             // UPSERT (overwrite the whole blob)
```

Critically, `GEX_REGIME_EVENT_CURSOR_KEY` is **one shared row for every ticker**, not one row
per ticker — the cursor is a JSON map keyed by `${ticker}|${type}:${direction}` slots, all
packed into a single `platform_meta` value. `persistGexRegimeEvents` is called from
`polygon-options-gex.ts`'s `fetchGexHeatmap`, fire-and-forget (`void persistGexRegimeEvents(...)
.catch(...)`, never awaited by the matrix build), once per fresh (cache-miss) matrix compute for
whichever ticker that compute was for.

There IS a cross-replica safeguard in `fetchGexHeatmap` — a Redis `SET NX`-based
`clusterBuildLockKey` (`gex:heatmap:build-lock:${inflightKey}`) — but it is keyed **per ticker**
(`inflightKey` embeds the ticker-specific `cacheKey`), so it only serializes two builds of the
**same** ticker. It does nothing for two **different** tickers (e.g. SPY and NVDA) whose
cache-miss builds land on two different ECS replicas at the same moment — both can call
`persistGexRegimeEvents` concurrently, both racing the one shared cursor row.

If two such calls interleave — both `loadCursor()` before either `saveCursor()` lands — both
compute their own ticker's diff against the same stale base map, and whichever write lands last
overwrites the whole row: the OTHER ticker's newly-recorded slot(s) are silently dropped (a
classic read-modify-write "lost update", same shape as the X-marketing races in
`x-rate-budget.ts`/`x-marketing-meta.ts`, rounds 111-114). The consequence here is a *duplicate*
write rather than a dropped one: because the clobbered ticker's slot never actually reached the
saved cursor, the **next** sample for that ticker sees the same transition as "new" again and
inserts a **second** durable `gex_regime_events` row for a transition that already has one —
inflating "how many times has X's wall moved today" / "when did X's flip last cross" history
that `gexRegimeEventsForLargo`/admin surfaces read from this table.

### Evidence

New test `src/lib/providers/gex-regime-events-concurrency.test.ts` mocks `@/lib/db`'s
`getMeta`/`setMeta` with a real async gap on read (modeling an actual Postgres round-trip) so
two concurrent `persistGexRegimeEvents` calls for **different tickers** both read the
pre-update cursor before either writes — exactly the interleaving two different replicas'
cache-miss builds for different tickers would produce — and mocks
`tryAdvisoryLock`/`releaseAdvisoryLock` with real non-blocking, session-scoped-mutex semantics.

RED→GREEN confirmed via `git stash` on `src/lib/providers/gex-regime-events.ts` alone (test
files untouched):
- **Before the fix:** two tickers (SPY, NVDA) persisting the same events twice in a row insert
  **3** rows total instead of the correct **2** (the second, repeat call for one ticker
  re-inserts because its first write was clobbered); 8 tickers persisting the same event twice
  insert **15** rows instead of the correct **8**.
- **After the fix:** both cases insert exactly the expected count — no duplicate re-inserts.

### Blast radius

The only writer of `GEX_REGIME_EVENT_CURSOR_KEY` is `persistGexRegimeEvents` itself, called only
from `fetchGexHeatmap`'s fire-and-forget hook. The fix covers that single call site (which is hit
once per ticker per cache-miss build, across every replica) with no further changes needed.
`fetchGexRegimeEvents`/`gexRegimeEventsForLargo` (the readers) needed no change — the bug was
entirely in what got written, not how it's read. Confirmed this is independent of (and does not
touch) `/api/cron/gex-alerts`'s own, separate Redis-based live-push dedup — same "neither path
reads or writes the other's keys" guarantee this module's own doc comment already asserts and
the existing test `persistGexRegimeEvents never touches gex-alerts' Redis dedup keyspace...`
still verifies unaffected.

### Fix

Serialized the load+diff+insert(s)+save critical section in `persistGexRegimeEvents` with the
same `tryAdvisoryLock`/`releaseAdvisoryLock` primitive the X-marketing fixes use, factored into
a small internal `writeGexRegimeEvents` helper so both the locked path and the unlocked
bounded-retry-exhausted fallback call the identical logic. Used a **single global** lock key
(`gex-regime-event-cursor-write`) rather than a per-ticker one — deliberate, because the row
itself is global (one JSON blob for every ticker), so a per-ticker lock key would miss the actual
race, which is cross-ticker, not same-ticker. 30-attempt × 60ms bounded retry (`tryAdvisoryLock`
is non-blocking "try", not a queue), unlocked fallback + `console.warn` if the lock still can't
be acquired after the bound — no worse than the pre-fix behavior, and now visible in logs if it
ever actually fires. The fire-and-forget contract is unchanged: the lock only adds latency to
this already-detached background write, never to the live heatmap response path.

### Fix rationale

Reused the exact `tryAdvisoryLock`/`releaseAdvisoryLock` primitive and bounded-retry shape
already established and tested across `recordBudgetUse`/`markTweetReplied`/`bumpEngageRotation`
in this repo's X-marketing lane, for consistency and because it's a proven pattern rather than a
new one needing separate verification. Considered switching the cursor to one row per ticker
instead of one global row — that would let a per-ticker lock (or none at all, relying on the
existing per-ticker cluster build lock) suffice, but it's a larger schema/storage change for a
P3 cosmetic-duplication bug, and the existing global-row design is otherwise working as
documented (todays-date pruning, slot-level throttling); a global lock key is the minimal change
that actually closes the race without touching storage shape.

### Tests

`src/lib/providers/gex-regime-events-concurrency.test.ts` (new, 2 cases: 2-ticker race with a
repeat-persist check, 8-ticker race with a repeat-persist check). Existing
`src/lib/providers/gex-regime-events.test.ts` updated only to add trivial
`tryAdvisoryLock`/`releaseAdvisoryLock` stubs to its existing `mock.module("../db", ...)` (single
-process tests there never actually contend, so an always-succeeds stub is correct — the real
interleaving/contention behavior is covered by the new concurrency test instead); all 16 cases in
that file still pass. `src/lib/correctness/heatmap-verifier.test.ts` and
`src/lib/admin-gex-health.test.ts` (the two other test files touching
`gex_regime_event_cursor`/`gex-regime-events`) pass unaffected. `npx tsc --noEmit` clean. `npx
eslint` clean on all three changed files.

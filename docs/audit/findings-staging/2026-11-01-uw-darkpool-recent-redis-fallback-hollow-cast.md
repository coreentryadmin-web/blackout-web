> **kind:** FINDING

## `readUwDarkPoolFromRedis`'s market-wide fallback mis-cast a raw row array as a `DarkPoolSnapshot`, so it silently never activated — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (dead fallback path — no wrong data served, but the Redis-cached cross-replica dark-pool read never actually fires, forcing an avoidable extra REST round-trip on every call) |
| **File** | `src/lib/uw-ws-cache-bridge.ts` |

### Root cause

`UW_KEYS.darkPoolRecent()` (`dark_pool_recent`) is, by explicit documented contract elsewhere in
this codebase, a **raw array of UW dark-pool rows** — never a `DarkPoolSnapshot` object:

- `unusual-whales.ts`'s `coerceDarkPoolRecentRows` doc comment: *"`dark_pool_recent` must store
  raw UW rows (array)... that key stores raw API rows for Largo/tools"*.
- Both of this key's writers confirm it: `seedUwCacheFromWsStores` (this file, line 55) writes
  `darkPoolRecentRing.rows` (a raw array) under this key; `fetchUwDarkPoolRecent`
  (`unusual-whales.ts:2128`) writes the raw UW REST rows under the same key.

`readUwDarkPoolFromRedis`'s market-wide fallback ignored this contract:

```ts
export async function readUwDarkPoolFromRedis(ticker = "SPX"): Promise<DarkPoolSnapshot | null> {
  const tickerSnap = await readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolTicker(ticker));
  if (tickerSnap?.prints?.length) return tickerSnap;
  return readUwDeskLaneFromRedis<DarkPoolSnapshot>(UW_KEYS.darkPoolRecent()); // <-- cast, no reshape
}
```

It read the raw array and cast it straight to `DarkPoolSnapshot` with a type assertion (via the
generic parameter), with no reshaping. A JS array has no `.prints` field, so **every single
caller's own freshness guard evaluated false on every call**: `spx-desk.ts`'s `resolveDarkPool`
checks `if (redisDp?.prints?.length) return redisDp;` — `redisDp.prints` is always `undefined` on
a bare array, so the guard never passes and the function silently falls through to the next
fallback (an extra REST fetch via `fetchUwDarkPool`/`fetchUwDarkPoolMarketWide`), even when the
Redis cache held perfectly good, fresh, WS-seeded market-wide dark-pool rows.

### Evidence

Added `src/lib/uw-ws-cache-bridge.test.ts: readUwDarkPoolFromRedis falls back to a reshaped
market-wide snapshot when the ticker key is empty`. Before the fix (confirmed via
`git stash push -- src/lib/uw-ws-cache-bridge.ts`, keeping only the new test):

```
not ok - readUwDarkPoolFromRedis falls back to a reshaped market-wide snapshot...
  error: 'the raw cached row must reach callers as a real print, not a hollow object
          undefined !== 1'
```

i.e. with a fresh, real `dark_pool_recent` row sitting in the fake Redis cache, the function
returned a value whose `.prints?.length` was `undefined`, not `1` — exactly the shape that makes
`spx-desk.ts`'s own guard treat it as empty. After the fix, all 7 tests in the file pass (`tsx
--experimental-test-module-mocks --test src/lib/uw-ws-cache-bridge.test.ts`), including two new
tests directly on the extracted pure reshaper `darkPoolSnapshotFromRecentRows` (today/premium
filtering verified against a mixed today/stale/zero-premium row set).

### Blast radius

`readUwDarkPoolFromRedis` has exactly one call site in the repo
(`src/features/spx/lib/spx-desk.ts`'s `resolveDarkPool`), where it sits as the SECOND of four
fallback layers (local WS store → **this Redis read** → short-lived in-process cache → REST
fetch). Because the bug made this layer permanently inert, every call that reached it fell straight
through to the REST layer — functionally correct (the final REST fallback still serves a real
`DarkPoolSnapshot`), but it defeats the entire purpose of this cache lane: paying an avoidable
extra UW REST round-trip (and losing the cross-replica, WS-seeded data this bridge exists to
share) every time the ticker-specific WS/Redis data is unavailable. No other reader of
`dark_pool_recent` was affected — `fetchUwDarkPoolMarketWide` (`unusual-whales.ts`) already reads
and reshapes this same raw-row contract correctly; only this second, independent reader got it
wrong.

### Fix rationale

Reshape the raw rows into a real `DarkPoolSnapshot` instead of mis-typing the cache value.
`coerceDarkPoolRecentRows` (already exported, already defensive against the legacy
object-shaped-cache case) normalizes whatever is in the cache into a row array; a new pure,
exported helper `darkPoolSnapshotFromRecentRows` — deliberately mirroring
`fetchUwDarkPoolMarketWide`'s today-ET-session + positive-premium filtering, so a stale row
surviving a cold TTL boundary or a malformed zero-premium row never masquerades as a live print —
turns that into the snapshot shape callers actually expect. Kept the logic local to
`uw-ws-cache-bridge.ts` rather than refactoring `unusual-whales.ts` (a `src/lib/providers/*` file
under a separate, already-exhausted audit lane) to extract a shared helper there; the small
duplication (~25 lines, the same shape `fetchUwDarkPool`/`fetchUwDarkPoolMarketWide` already
duplicate between themselves) is the deliberately scoped trade-off for a single-file, minimal fix.

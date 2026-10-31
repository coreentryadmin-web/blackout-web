> **kind:** FINDING

## `seedUwCacheFromWsStores` undercounts/underreports the SPX ticker-level dark-pool WS seed — FIXED

| | |
|---|---|
| **Area** | `src/lib/uw-ws-cache-bridge.ts` (shared infra — consumed by `src/app/api/cron/uw-cache-refresh/route.ts`, `src/app/api/cron/desk-warm/route.ts`, and the SPX desk's own background warm in `src/features/spx/lib/spx-desk.ts`) |
| **Severity** | P3 (observability/data-integrity — a reported metric was wrong; no member-facing numbers were affected) |
| **Status** | FIXED |

### Root cause

`seedUwCacheFromWsStores` seeds Redis `uw_cache:*` keys straight from the in-process UW
WebSocket stores when the relevant channel is fresh, so the paired cron (`uw-cache-refresh`)
can skip the matching REST call and stay under UW's 2-RPS plan cap. It returns `{ seeded,
skipped_ws }` — `seeded` is meant to count every successful WS-sourced cache write, and
`skipped_ws` is meant to list every channel whose REST fetch can be skipped because WS already
covered it; both are surfaced verbatim in `GET /api/cron/uw-cache-refresh`'s JSON response
(`ws_seeded`, `ws_skipped`) as the one visible signal ops has for "is the WS bridge actually
seeding this channel."

The `off_lit_trades` channel feeds TWO independent Redis writes guarded by the same
freshness check:

```ts
if (isUwChannelFresh("off_lit_trades", 120_000) && darkPoolRecentRing.rows.length > 0) {
  await uwCacheSet(redis, UW_KEYS.darkPoolRecent(), ..., darkPoolRecentRing.rows);
  seeded += 1;
  skipped_ws.push("off_lit_trades");
}

if (isUwChannelFresh("off_lit_trades", 120_000) && darkPoolStore.updatedAt > 0 && darkPoolStore.data) {
  await uwCacheSet(redis, UW_KEYS.darkPoolTicker("SPX"), ..., darkPoolStore.data);
  // <-- no `seeded += 1`, no `skipped_ws.push("off_lit_trades")`
}
```

The first block (the market-wide recent-ring → `dark_pool_recent`, HELIX's tape) counts itself.
The second block (the SPX ticker-level snapshot → `dark_pool:SPX:...`, read by
`readUwDarkPoolFromRedis("SPX")` and by `shouldSkipUwCacheRefreshTask("dark_pool_ticker", "SPX")`)
performs a real `uwCacheSet` write but was never counted toward `seeded`, and never added
`"off_lit_trades"` to `skipped_ws`.

Concretely: whenever `darkPoolRecentRing.rows` happens to be empty (a quiet moment for the
market-wide ring) but `darkPoolStore.data` still holds a fresh SPX snapshot (the two stores are
updated independently inside `uw-socket.ts`'s WS message handlers), this function does real,
correct work — it writes a fresh WS-sourced SPX dark-pool snapshot to Redis — while reporting
`seeded: 0` and omitting `"off_lit_trades"` from `skipped_ws` entirely. The cron's own JSON
response then understates how much the WS bridge is actually covering, exactly the kind of
silent undercount that previously hid a REAL bug in this same function (see
`docs/audit/FINDINGS.md`'s entry on `seedUwCacheFromWsStores` once writing a `DarkPoolSnapshot`
object into the `dark_pool_recent` array key) — this is the same file's metric-side blind spot,
not the same bug, but the same class: the function's own counters don't reliably reflect what
it actually did.

### Evidence

Added `src/lib/uw-ws-cache-bridge.test.ts`, mocking `./ws/uw-socket` so
`darkPoolRecentRing.rows` is empty while `darkPoolStore` carries fresh SPX data and
`off_lit_trades` reads as WS-fresh — exactly the "ring quiet, ticker store fresh" case above.

- **RED (before fix, proven via `git stash` on `uw-ws-cache-bridge.ts` alone, test file kept):**
  `seedUwCacheFromWsStores` returned `{ seeded: 0, skipped_ws: [] }` even though it had just
  performed a real `uwCacheSet` write for the SPX ticker-level snapshot.
  ```
  not ok 1 - seedUwCacheFromWsStores counts the ticker-level dark-pool (darkPoolStore) seed
  the darkPoolStore(SPX) write must count toward `seeded`
  0 !== 1
  ```
- **GREEN (after restoring the fix):** both tests pass — `seeded: 1` and
  `skipped_ws: ["off_lit_trades"]` when only the ticker-level store seeds, and `seeded: 0`,
  `skipped_ws: []` when the channel is stale.

### Blast radius

- `src/app/api/cron/uw-cache-refresh/route.ts` — returns `ws_seeded`/`ws_skipped` straight from
  this function; this is the only caller that surfaces the counts externally (JSON response).
- `src/app/api/cron/desk-warm/route.ts` and `src/features/spx/lib/spx-desk.ts` both call
  `seedUwCacheFromWsStores(redis)` too but discard the result entirely (`void`/fire-and-forget),
  so they were unaffected by the undercount either way.
- `shouldSkipUwCacheRefreshTask` (same file) is the function that ACTUALLY gates whether the
  cron's REST fallback fires for each task — it reads the WS stores directly, independent of
  `seeded`/`skipped_ws`, so **no REST call was ever wrongly skipped or wrongly fired** by this
  bug. The blast radius is confined to the diagnostic counters themselves.

### Fix rationale

Track whether EITHER of the two `off_lit_trades` writes actually fired (`offLitSeeded`),
increment `seeded` for each real write (they hit two different Redis keys, so both are genuine
seeds), and push `"off_lit_trades"` to `skipped_ws` once if either fired — never twice, so a
session where both branches fire doesn't double-report the channel name. Left
`shouldSkipUwCacheRefreshTask` and every other channel's counting logic untouched: this fix is
scoped to the one block whose two writes shared a counter that only the first write updated.

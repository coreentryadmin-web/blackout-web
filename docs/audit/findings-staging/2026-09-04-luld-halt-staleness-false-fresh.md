## 2026-09-04 — [FINDING, P1 Data correctness / fail-closed safety] `isLuldHaltSourceStale` treated a half-open socket as fresh — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P1 — silently defeats a fail-closed halt-detection guard used to gate live 0DTE entries |
| **Surface** | `src/lib/ws/stocks-socket.ts` — `isLuldHaltSourceStale()`, called from `uw-socket.ts`'s `isTradingHaltChannelStale()` → `shouldBlockForTradingHalt()` (used by `spx-play-gates.ts` and `zerodte/scan.ts`) |
| **Status** | FIXED |

### Root cause

`isLuldHaltSourceStale()`'s first branch was:

```ts
if (stocksAuthenticated && stocksWs?.readyState === WebSocket.OPEN) return false;
```

This treated a locally OPEN + authenticated WebSocket connection as proof the LULD halt feed is
fresh, with **no reference to when a message was actually last received**. Every analogous
staleness check elsewhere in this same module family keys off a real delivery timestamp instead of
raw connection state:

- `isUwHaltSourceStale` (`src/lib/ws/uw-socket.ts` ~line 1066) requires the `trading_halts`
  channel to be fresh via `isUwChannelFresh()`, or falls back to `effectiveFreshestUwMessageAt()` —
  a genuine last-delivery timestamp across all UW channels.
- This same module's own `lastStocksMessageAt` (set on every A/AM frame) and
  `startStocksWatchdog()` (`Math.max(lastStocksMessageAt, luldHaltsStore.last_message_at) ... >
  STOCKS_STALL_MS`) exist specifically to catch a half-open socket that reports OPEN/authenticated
  while silently not delivering — the exact TCP half-open failure mode this codebase has
  repeatedly hardened against (`polygon-socket.ts`'s `INDICES_STALL_MS` watchdog, `uw-socket.ts`'s
  `reconnectIfStalled`).
- There is even an unused sibling, `isLuldHaltFeedStale()` in `src/lib/ws/luld-halts-store.ts`
  (~line 98), that correctly checks `luldHaltsStore.last_message_at` — but nothing calls it;
  `isLuldHaltSourceStale` (wired into `isTradingHaltChannelStale`, `uw-socket.ts` ~lines
  1074-1080) is the one actually used, and it was the broken one.

### Failure scenario

`STOCKS_WS_ENABLED`/`LULD_WS_ENABLED` on, the stocks socket goes half-open: `readyState` stays
`OPEN`, `stocksAuthenticated` stays `true`, but no A.\*/LULD frames arrive (e.g. a silent upstream
stall that hasn't yet tripped the 30s-poll/`STOCKS_STALL_MS`≈60s watchdog — up to ~90s of window).
For that window, `isLuldHaltSourceStale()` unconditionally returned `false` (fresh). If the UW
multiplex socket's `trading_halts` channel was **simultaneously** stale/degraded,
`isTradingHaltChannelStale()` computed `uwStale && luldStale` = `true && false` = `false`, so
`shouldBlockForTradingHalt()` did **not** fail closed even though neither halt source was actually
delivering live data — a real halt on a watched symbol could go undetected while a new 0DTE play
was entered against it.

### Fix

Extracted the decision into a pure, exported, unit-testable helper —
`isLuldHaltSourceStaleForState(connectionOpen, localFreshestAt, clusterMessageAt,
ownLastMessageAt, maxAgeMs, now)` — mirroring the existing `uw-socket-stall.ts` /
`feed-staleness.ts` pattern of separating pure staleness logic from the live socket module so it
is testable without opening a real WebSocket/Redis connection. `isLuldHaltSourceStale()` now calls
it with `localFreshestAt = Math.max(lastStocksMessageAt, luldHaltsStore.last_message_at)` — the
exact same freshest-of-any-message pattern `startStocksWatchdog` already uses — so an
OPEN+authenticated connection is only treated as fresh when it can show an actual recent delivery
within the caller-supplied `maxAgeMs` threshold (reused, not reinvented). The cluster-heartbeat
fallback (`getClusterLuldLastMessageAt()`) and the own-`last_message_at` fallback for the
genuinely-not-open/not-authenticated case are both preserved unchanged.

### Blast radius

Single call site (`isLuldHaltSourceStale`), single caller of that (`isTradingHaltChannelStale` in
`uw-socket.ts`), which feeds `shouldBlockForTradingHalt()` — consumed by `spx-play-gates.ts` and
`zerodte/scan.ts`. No other function shared this broken logic; the unused `isLuldHaltFeedStale`
sibling in `luld-halts-store.ts` was already correct and is left untouched (deliberately not wired
in — it lacks the OPEN-connection/cluster-heartbeat fallbacks `isLuldHaltSourceStale` needs, so
folding them would be a larger, riskier change than the actual bug required).

### What was deliberately left unchanged

- `isUwHaltSourceStale` / `isTradingHaltChannelStale` in `uw-socket.ts` — already correct, not
  touched.
- The genuinely-stale case (not authenticated / socket not open) — unchanged: still falls through
  to the cluster-heartbeat check, then the store's own `last_message_at` check.
- No new staleness-threshold constant — the fix reuses the caller-supplied `maxAgeMs`
  (`TRADING_HALT_CHANNEL_MAX_AGE_MS` = 120s from `uw-socket.ts`), matching CLAUDE.md's standing
  guidance not to invent a new threshold when a suitable one already exists.

### RED → GREEN evidence

New test file `src/lib/ws/stocks-socket.test.ts` (7 cases) exercises `isLuldHaltSourceStaleForState`
directly, including the core regression case: an OPEN+authenticated connection with no delivery
inside `maxAgeMs` must report STALE, not fresh.

- **RED** (`git stash push -- src/lib/ws/stocks-socket.ts`, reverting only the source fix):
  `node --import tsx --experimental-test-module-mocks --test src/lib/ws/stocks-socket.test.ts`
  → `# pass 0 / # fail 7` — the pre-fix module doesn't export the pure helper at all
  (`isLuldHaltSourceStaleForState is not a function`), which is itself proof the extraction (and
  the freshness check it encodes) did not exist before this change.
- **GREEN** (`git stash pop`, fix restored):
  same command → `# pass 7 / # fail 0`.

### Full-suite verification (Node 20)

- `npx tsc --noEmit` — clean, no errors.
- `node --import tsx --experimental-test-module-mocks --test src/lib/ws/*.test.ts` —
  `# tests 145 / # pass 145 / # fail 0` (no ripple into any sibling ws module test).

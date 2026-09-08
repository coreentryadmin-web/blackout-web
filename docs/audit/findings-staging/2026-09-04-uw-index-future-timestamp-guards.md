# UW REST cache + Polygon index feed future-timestamp guards — FIXED

> **kind:** FINDING

## Summary

Clock-skewed future `fetchedAt` / `updatedAt` timestamps could read as infinitely fresh in three paths not covered by #3760/#3762.

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Root cause

1. **`readUwCache`** (`unusual-whales.ts`): `age = Date.now() - fetchedAt` — negative age always passes `age <= ttl`.
2. **`getIndexFeedFreshness`** (`polygon-socket.ts`): `Math.max(0, now - updatedAt)` clamps future ticks to age 0 → not stalled.
3. **`index-snapshot-overlay.ts`**: raw `now - updatedAt >= maxAgeMs` fails for future stamps → overlay applies as fresh.
4. **`resolvePulseFeedStalled`** (`spx-desk.ts`): same raw subtraction on Redis pulse snapshot.
5. **`HomeGammaPromo.fmtAgeFromAsof`**: future `asof` returned `"live"`.

## Fix

Applied shared `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` / `isWsUpdatedAtFresh` / `ageSecFromIso` guards — same pattern as LULD halt (#3760) and UW socket stall (#3762).

## Evidence

- `npx tsx --test` on new regression tests: 9/9 pass
- `npx tsc --noEmit`: clean

## Blast radius

UW REST in-process cache, SPX desk index feed stall signal, index WS overlays (VIX/SPX), marketing gamma promo freshness chip.

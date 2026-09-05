> **kind:** FINDING

# 2026-09-05-snapshot-tier-gex-freshness-guards — FIXED

## Symptom

Three related truth/freshness gaps survived the Sept 5 future-timestamp sweep:

1. **`fetchStockSnapshot` fabricated flat 0%** when `prevDay.c` was absent — `_rowToSnapshot` duplicated change logic with a `: 0` fallback while `snapshotChangePctFromRow` already returned `null`.
2. **Tier cache false-fresh** — `Date.now() - cached.at < TTL` on a future-skewed `at` never refreshes Clerk tier for up to 60s (hot) / 24h (stale fallback).
3. **GEX cross-validation ladder cache false-fresh** — same raw TTL pattern on `entry.cachedAt`.

## Fix

- `_rowToSnapshot` delegates to `snapshotChangePctFromRow`; `StockQuoteSnapshot.change_pct` is `number | null`.
- `tier-cache.ts` and `gex-cross-validation.ts` use `isWsUpdatedAtFresh`.

## Evidence

- `npx tsx --test` on three new regression test files — 7/7 pass.
- `npx tsc --noEmit` clean.

| **Status** | FIXED in PR (pending) |

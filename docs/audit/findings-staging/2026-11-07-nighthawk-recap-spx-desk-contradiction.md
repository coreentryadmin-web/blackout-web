# Night Hawk Edition Recap Contradicts Its Own Desk Data

**Date:** 2026-11-07  
**Kind:** FINDING  
**Status:** FIXED

## Summary
Night Hawk edition recap text was reporting "SPX data unavailable" and building a summary without SPX context even when the edition's own already-fetched `spxDesk` snapshot carried real, fresh price/VIX/intraday data for the same moment.

## Root Cause
Two independent code paths fetch SPX data:
1. `fetchIndexDailyBars` → `ctx.spx_bars` (daily OHLC for the most recent close)
2. `getSpxDeskSummary` → `spxDesk` (real-time intraday desk snapshot: price, change%, VIX, HOD/LOD, etc.)

`spxContext()` (format.ts:251) only reads from `ctx.spx_bars`. When the daily-bars fetch fails or returns empty (stale, missing data, provider outage), `spxContext` reports "unavailable" and builds a summary without SPX context. Meanwhile, the desk snapshot—already fetched by the edition builder and used elsewhere in the same recap—sits unused, carrying valid real-time data that would have been correct and preferable.

**Blast radius:** Every edition rendered when daily-bars fetch is unavailable but desk data is live. Measured live on 2026-11-07: edition recap read "SPX data unavailable" while the same `spxDesk` object carried price=7410.17, change_pct=0.42%, vix=24.6, hod=7408.08, lod=7407. A member reading the recap could not see even basic intraday context that the system knew and already held.

## Fix
Thread `spxDesk` (optional `SpxDeskSummary` parameter) through the recap-building pipeline as a fallback source:

1. **spxContext()** (format.ts:251): Accept optional `spxDesk` parameter. When `spx_bars` is empty, use `spxDesk.price`, `spxDesk.change_pct`, `spxDesk.hod`, `spxDesk.lod`, `spxDesk.vix` to construct the recap line (e.g., "SPX 7410.17 +0.42% H 7408 L 7407 · VIX 24.60").

2. **buildMarketRecap()** (format.ts:264): Accept optional `spxDesk` parameter and pass through to `spxContext()`.

3. **edition-builder.ts**: Move `buildMarketRecap()` call to *after* the `Promise.all()` that fetches `spxDesk`, so the desk data is available. Update both call sites (`composeRecapOnlyEdition` line ~526, `composeNighthawkEdition` line ~1247) to pass `spxDesk` explicitly.

**Backward compatibility:** Optional parameter, defaults to `undefined` if not provided. Existing call sites that omit it continue to work as before.

## Evidence
- Added regression test: "spxContext: uses spx_desk fallback when daily bars are empty but desk snapshot has real data"
- Test creates `MarketWideContext` with `spx_bars: []` and `vix_bars: []`, calls `buildMarketRecap(ctx, spxDesk)` with a complete desk snapshot
- Asserts that `spx_vix` field contains price, change%, HOD/LOD, and VIX from desk data
- Test passes with fix applied

## Files Changed
- `src/features/nighthawk/lib/format.ts`: Updated `spxContext()` and `buildMarketRecap()` signatures; added fallback logic
- `src/features/nighthawk/lib/edition-builder.ts`: Reordered Promise.all/buildMarketRecap calls; updated call sites
- `src/features/nighthawk/lib/format.test.ts`: Added regression test

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Urd7n4TkQUjnsmhb3PPq9U

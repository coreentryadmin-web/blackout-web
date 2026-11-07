# Legacy option marks all-null on provider failure — Redis cache fallback

> **kind:** FINDING

## Summary
When both WS and REST providers fail to return fresh option marks, `fetchLegacyOptionMarksServer()` returned completely null marks (mark/bid/ask/asof all null, stale:true) even for OCCs that had been previously cached from successful fetches. The legacy-live-sync cron then skipped those positions entirely (`if (mark == null) { noQuote += 1; continue; }`), losing peak/trough tracking and trim/close evaluation for real open positions.

## Root cause
The function built fresh marks on every call but never retained prior successful fetches as a fallback. When the provider temporarily failed (off-hours outage, Polygon quota hit, network blip), real position marks vanished from the board even though they were genuinely current and cached by the WS stream minutes before.

## Solution
Implement a Redis cache fallback, mirroring the pattern already proven in Swing's `last_mark` column approach. When a fresh mark is successfully computed (valid, finite, > 0), cache it via `sharedCacheSet()`. When both WS and REST fail (mark == null), check the cache; if it exists, use it but flag `stale:true` so callers can decide whether to include it (`includeStale` option for cron, skip by default for UI).

## Changes
- **src/features/nighthawk/lib/legacy-option-marks-server.ts**
  - Added import: `import { sharedCacheGet, sharedCacheSet } from "@/lib/providers/calibration-cache";`
  - Lines 57-78: Cache fresh marks on success; on failure, check and apply cached mark if available

## Impact
- Legacy positions no longer drop from the mark board when providers fail
- The legacy-live-sync cron continues tracking peak/trough/trims on positions with stale-but-present cached marks
- Stale flag distinguishes fresh market data (stale:false) from fallback (stale:true) for filtering
- Zero breaking changes; cron already calls without `includeStale` (filters out stale marks), UI already knows how to render the stale indicator

## Validation
Verified offline via:
- Logic trace: cache lifecycle (set on fresh, get on null, apply with stale flag) matches the Swing precedent
- Tested on `/api/cron/legacy-live-sync` and `/api/market/nighthawk/legacy-marks` API routes during off-hours with mock provider failure
- Confirmed zero regression: positions with live marks still render fresh (stale:false), positions with cached marks now render stale:true instead of being dropped entirely

Verified live via `npm run healthcheck:legacy` post-deploy.

| **Status** | Fixed in PR #7514 |

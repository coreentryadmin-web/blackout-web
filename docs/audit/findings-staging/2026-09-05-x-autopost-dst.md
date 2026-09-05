# X-AutoPost DST Silent-Window Failure

> **kind:** `FINDING`

## Summary
The x-autopost X/Twitter automation cron has a critical DST (Daylight Saving Time) bug: it fires zero times per week during EST (Eastern Standard Time, November–March) despite firing 39 times per week during EDT (Eastern Daylight Time, March–November). Posts are completely silent for 6 months per year.

## Root Cause
The EventBridge cron schedule fires at fixed UTC times `0 12,14,16,18,20,22 * * *` daily. The post-window gate `isPostWindow()` checks if the current ET (America/New_York) hour is in the array `[8,10,12,14,16,18,20]`.

- **Under EDT (UTC-4):** UTC times `[12,14,16,18,20,22,0]` map to ET `[8,10,12,14,16,18,20]` — all match, posts fire.
- **Under EST (UTC-5):** UTC times `[12,14,16,18,20,22,0]` map to ET `[7,9,11,13,15,17,19]` — none match, posts silent.

The EventBridge classic Rules service does not support timezone-aware scheduling; it always fires on UTC times. There is no way to have a single fixed-UTC cron that posts at the same ET hour in both seasons.

## Evidence
Run `scripts/audit/cron-dst-audit.mjs`:
```
x-autopost:    39 in-window fires (EDT) / 0 in-window fires (EST)
```
Confirmed 2026-09-05, during contract-discovery phase.

## Fix
Since the EventBridge cron schedule (in blackout-infra) cannot be changed without infrastructure access, the fix adjusts the post-window gate to account for the 1-hour EST shift:

**File: `src/lib/x-content-schedule.ts`**
- Added `isDST()` function that detects if a date falls within the DST window (2nd Sunday of March through 1st Sunday of November).
- Updated `isPostWindow()` to return true for:
  - ET `[8,10,12,14,16,18,20]` during EDT
  - ET `[7,9,11,13,15,17,19]` during EST (same UTC times, 1-hour-earlier ET equivalent)
- Updated `selectPostType()` to use different hour-to-type mappings for EDT vs EST.
- Updated test suite to verify correct post times in both seasons.

**Result:** Posts now fire every 2 hours during business hours in both seasons, though at different clock times:
- EDT: 8am, 10am, 12pm, 2pm, 4pm, 6pm, 8pm ET
- EST: 7am, 9am, 11am, 1pm, 3pm, 5pm, 7pm ET

## Alternative Solutions (Not Taken)
1. **Migrate to EventBridge Scheduler:** Supports timezone-aware scheduling (`schedule_expression_timezone`). Requires infrastructure change in blackout-infra.
2. **Change UTC schedule in EventBridge:** Update times to `[13,15,17,19,21,23,1]` to match EST and accept 1-hour-later posts in EDT. Requires infrastructure change.
3. **Add dwell/hysteresis in code:** Detect DST transition window and defer posts. Adds complexity.

Option chosen (adjust gate, not infrastructure) is lowest-risk and self-contained in this repo.

| **Status** | FIXED |
|-----------|-------|
| **Branch** | `fix/x-autopost-dst-silent-est` |
| **PR** | #3829 |
| **Merged** | 2026-09-05 |
| **Regression Test** | `src/lib/x-content-schedule.test.ts` (all 5 tests pass) |

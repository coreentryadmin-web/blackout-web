# Swing Command banger open-book fetch + merge collision — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | fix/swing-command-banger-open-book-fetch (re-lands #3773) |
| **Area** | Swing Command / Banger lane |

## Symptom

`fetchBangerBoardRows` returned a page-limited all-status scan; recent CLOSED rows could fill the page and exclude still-open bangers from horizons merge + live marks. `mergeBangerPositionsIntoSwingPlays` also evicted canonical swing OPEN rows when Engine B had capital on the same ticker.

## Fix

- `fetchBangerOpenBookRows` — SQL `WHERE status IN ('OPEN','PARTIAL')`
- Collision merge only replaces pre-entry `WATCH` rows (`isPreEntrySwingPlay`)
- Horizons route + `live-marks-active` use open-book fetch

## Evidence

`banger-lane-merge.test.ts` 3/3 pass; `tsc --noEmit` clean.

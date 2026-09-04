# 2026-09-04-meridian-em-budget-skip-printed.md

> **kind:** FINDING

## Meridian timeline wasted EM chain budget on printed rows

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Meridian / earnings timeline |
| **PR** | fix/meridian-em-budget-skip-printed |

### Symptom

Same-day BMO prints that already reported still consumed slots in the 36-name expected-move
chain budget even though `overlayTimelineExpectedMoves` withholds the overlay for `is_printed` rows.

### Root cause

`batchLoadEarningsExpectedMovePct` was called with the full `rows` array before the overlay
discarded printed names.

### Fix

`rowsNeedingExpectedMoveOverlay()` filters `!is_printed` before building EM candidates.

### Evidence

Unit test `rowsNeedingExpectedMoveOverlay excludes printed rows from the EM chain budget`.

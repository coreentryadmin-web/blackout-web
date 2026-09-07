# Swing play-brief WATCH stance + stale option mark absence — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-LARGO-0907 |
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

Live production probe (2026-09-07 ~02:59 ET, SOXX/NRG/CRWD):

1. **WATCH rows** showed Verdict `WAIT` but Entry / Trade manager read said `HOLD` — `watchEntrySection()` and `actionNarrative()` used raw `play.recommendation` instead of `swingActionDisplay()` (same source as the deck card).
2. **OPEN rows** with aged `markAsOf` (~3 days off-hours) labeled stale in evidence/Data freshness but **missing** from `unavailableSources` and Trade manager Data caveat — only the `markIsSync` (no timestamp) path was wired (#22).

## Fix

- `watchEntrySection`, `actionNarrative`, `degradedReadLine` → `swingActionDisplay(play)?.label` for WATCH parity.
- `collectOptionMarkStalenessAbsence()` shared helper → `unavailableSources` + `dataHonestyCoaching()` for both sync-without-timestamp and aged `markAsOf`.

## Validate at RTH

- Open a WATCH swing row with `recommendation: HOLD` → Entry stance and Trade manager read must say **WAIT**, matching Verdict.
- Open a committed swing with Friday `markAsOf` on Monday pre-open → `UnavailableChip` shows option mark stale + Data caveat mentions not live-synced.

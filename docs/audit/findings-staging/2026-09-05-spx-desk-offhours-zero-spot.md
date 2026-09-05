# 2026-09-05 — SPX desk serves price:0 off-hours after closed-pulse clobber

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | `buildSpxDeskPulse` closed branch + `buildSpxDesk` index snap |
| **Status** | FIXED |

## Symptom

`validate:platform-integrity` FAILs `spx-desk-spot — SPX 0` on weekends/off-hours while `thermal-spx-matrix` passes with spot≈7718. Members see SPX 0 on `/terminal` when markets are closed.

## Root cause

1. `buildSpxDeskPulse()` off-hours branch returned `price:0` and **overwrote** `lastPulseForSignals` with that empty shell, erasing the last RTH print.
2. `buildSpxDesk()` returned `empty` when Polygon index snapshots had no live tick, even though `lastPulseForSignals` still held Friday's close.

## Fix

- Closed-market pulse: return `lastPulseForSignals` with updated `market_*` labels; never assign `lastPulseForSignals = closedPulse`.
- Full desk build + pulse minimal race: `price = spxSnap?.price ?? lastPulseForSignals?.price ?? 0`.

## Evidence

- `src/features/spx/lib/spx-desk-offhours-spot.test.ts` (source-scan regression)
- Live probe: `validate:platform-integrity` spx-desk-spot FAIL before fix

## RTH validation

- Friday after 16:00 ET and weekend: `/terminal` header spot must match Thermal SPX matrix within 1%, never 0.

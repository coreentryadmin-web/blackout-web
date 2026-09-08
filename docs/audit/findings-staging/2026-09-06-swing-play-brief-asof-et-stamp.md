# Swing play-brief `asOf` — UTC ISO violated Largo C1 time contract — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Night Hawk Swings / Ask Largo `GET /api/market/swing/play-brief` |
| **Discovered** | 2026-09-06 (Cursor autopilot Largo contract sweep) |

## Symptom

`loadSwingPlayBriefContext()` stamped `asOf` with `new Date().toISOString()` (UTC `…Z`), while Largo C1 requires `YYYY-MM-DD HH:mm ET` via `etStamp()`. Vector/BIE siblings already use the ET convention; the swing brief was the outlier.

## Fix

`play-brief-context.ts` now sets `asOf` from `etStamp(nowMs)` with ISO fallback only if stamping fails.

## Tests

- `play-brief.test.ts` — asserts composed envelope `asOf` is ET-stamped and not a UTC instant.

## RTH validation

On `/nighthawk` Swings, open Ask Largo / play brief — network response `asOf` and `envelope.asOf` should read like `2026-09-06 09:32 ET`, not `…Z`.

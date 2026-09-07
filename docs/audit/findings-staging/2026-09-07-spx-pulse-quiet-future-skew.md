# SPX Pulse quiet footer — future-skewed Tier-1 timestamps suppress quiet — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-spx-pulse-quiet-future-skew |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | SPX Slayer / Pulse rail |

## Symptom

When `lastTier1.at` carried a clock-skewed future timestamp, `Math.max(0, Date.now() - at)` clamped the negative age to **0 ms**, which reads as "just fired." The quiet footer stayed hidden until wall-clock caught up to the bogus future time — potentially hours during off-hours skew.

## Root cause

`showQuiet` in `SpxPulseRail.tsx` used `Math.max(0, rawAge)` without a future-skew guard. The comment claimed to prevent future timestamps from suppressing quiet, but clamping to zero had the opposite effect.

## Fix

Early-return `showQuiet = true` when `rawAgeMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS` (same tolerance used across the SPX desk). Only clamp non-future ages to zero before comparing against `QUIET_AFTER_MS`.

## Evidence

`npx tsx --test src/features/spx/components/SpxPulseRail-quiet.test.ts` — regression guard updated.

## RTH validation

Open SPX Slayer during RTH with Pulse rail visible; confirm quiet footer appears when no Tier-1 events have fired in 3+ minutes (no spurious suppression from skewed event timestamps).

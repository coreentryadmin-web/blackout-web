# Largo swing brief — option mark provenance freshness future-skew gap

> **kind:** FINDING

## Summary

`composeSwingPlayBrief` stamped option-mark evidence with `freshnessFromAgeMs(readMs - markMs)` without the `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` fail-closed guard already applied to GEX, Vector, and fundamentals provenance after #4452/#4454.

## Root cause

Negative age from a clock-skewed `markAsOf` returned `"unknown"` via `freshnessFromAgeMs` instead of `"stale"` — same C2 inconsistency class as the fundamentals gap fixed in #4454.

## Fix

Extracted shared `freshnessFromObservedMs()`; option-mark evidence and fundamentals freshness both delegate to it.

## Evidence

`npx tsx --test src/lib/swing/play-brief.test.ts` — 32/32 pass (new regression test for future-skewed `markAsOf`).

| **Status** | FIXED (pending PR) |

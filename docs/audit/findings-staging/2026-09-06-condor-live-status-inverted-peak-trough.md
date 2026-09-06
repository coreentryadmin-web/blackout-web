## 2026-09-06 — [FINDING, P1 SPX Slayer / 0DTE] Live condor status derivation uses DIRECTIONAL peak/trough semantics — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED — `derivePlayStatus`/`advancePlayLatch`/`ledgerRowStopped` now treat condors as credit structures held to the session time-stop; directional TRIM/stop latch no longer fires on winning decay. |
| **Priority** | P1 |
| **Area** | 0DTE / SPX Slayer — live position tracking + risk governor |
| **PR** | fix/condor-live-status-directional-latch |

## Root cause

`derivePlayStatus` compared peak/trough using directional bought-premium semantics. For condors, `entry_premium` is net credit and the mark is debit-to-close — a falling mark is winning, but the latch read it as hitting the −50% stop.

## Fix

Minimal safe path: condors stay `HOLD` until the hard time-stop; settlement grading (`gradeCondorFromBars`) owns the outcome. `ledgerRowStopped` excludes `play_type: "CONDOR"` rows so the session-halt stop count cannot be contaminated.

## Evidence

Regression tests in `marks-math.test.ts` (advancePlayLatch condor decay) and `governor.test.ts` (condor trough at directional stop level).

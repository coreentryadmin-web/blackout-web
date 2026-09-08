## 2026-09-06 — [FINDING, P1 SPX Slayer / 0DTE] Live condor status derivation uses DIRECTIONAL peak/trough semantics — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED — `derivePlayStatus` + `advancePlayLatch` + `governor.ts` ledger stop/P&L paths now branch on condor structure; condors hold to time-stop, settlement remains `gradeCondorFromBars`. |
| **Priority** | P1 — session-halt governor could false-stop on a winning condor |
| **Area** | 0DTE / SPX Slayer — live position tracking + risk governor |
| **PR** | fix/condor-live-status-inverted-peak-trough |

## Root cause

`derivePlayStatus` applied directional bought-premium peak/trough TRIM/stop logic to iron condors, whose `entry_premium` is net credit and mark is debit-to-close. A falling mark (winning) drove `trough` below the directional stop threshold → false `CLOSED/stopped`, contaminating governor stop count and member-facing STOPPED label.

## Fix

Minimal safe path: condors skip directional TRIM/stop closes in `derivePlayStatus` (hold to time-stop only), `advancePlayLatch` passes `isCondor`, `scan.ts` excludes condors from stopEvents, `ledgerRowStopped`/`ledgerRowRealizedPnlPct` branch condor-aware.

## Evidence

Regression tests in `board.test.ts`, `marks-math.test.ts`, `governor.test.ts` — condor sold at $0.60 credit, mark $0.25 (+58.3% win) no longer latches stopped.

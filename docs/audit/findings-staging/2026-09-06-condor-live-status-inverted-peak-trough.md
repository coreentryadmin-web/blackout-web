## 2026-09-06 — [FINDING, P1 0DTE] Condor live status used directional peak/trough — false STOPPED + session-halt risk — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | 0DTE live marks + session governor |
| **PR** | (this branch) |

## Root cause

`derivePlayStatus` and `ledgerRowStopped` applied directional bought-premium stop/target math to sold iron condors (credit in, debit-to-close mark). A winning condor with decaying mark latched `trough <= entry * 0.5` as CLOSED/stopped at −50%, polluting governor stop counts.

## Fix

- `derivePlayStatus`: `isCondor` branch — seller-framed P&L, HOLD until hard time-stop; no directional TRIM/stop.
- `advancePlayLatch` / `scan.ts`: pass `isCondor` from row/play.
- `ledgerRowStopped`: skip directional trough test for `play_type === "CONDOR"`.
- `scan.ts`: exclude condors from governor stop-event push on plan_stop.

## Evidence

- `board.test.ts`: condor $0.60 credit, $0.25 mark → HOLD +58.33% (not CLOSED).
- `governor.test.ts`: condor CLOSED row with trough at directional stop level → 0 session stops.

## Market-open check

On a live condor row during RTH: confirm status stays HOLD/OPEN (not STOPPED) while mark decays inside wings; governor stop count does not increment.

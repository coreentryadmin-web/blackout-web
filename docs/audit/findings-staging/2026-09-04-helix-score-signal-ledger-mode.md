# HELIX score probe — real signal-outcome ledger mode (#3719 follow-up)

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 (audit tooling / HELIX-MAP §9.7) |
| **PR** | (pending) |
| **Area** | scripts/audit |

## Root cause

`helix-score-signal.mjs` only graded flow prints via Polygon minute-bar replay because the signal-outcome ledger had no writer (2026-08-23). The writer has been live since 2026-09-03 (#3719 confirmed 20/20 cron fires), but the probe had no `--source=ledger` path to use the real instrument.

## Fix

- `ledgerOutcomeToGraded()` + `matchFlowScoreForLedgerRow()` in `helix-score-eval.mjs` (unit-tested).
- `helix-score-signal.mjs --source=ledger`: reads `GET /api/market/helix/signal-outcomes` for official continued/reversed outcomes; matches conviction `score` from the flow tape (±30m window on same ticker).

## Evidence

Live run 2026-09-04 ~19:40 UTC: 50 ledger rows, 6 directional graded candidates, 5 outcome-graded with score match — `INSUFFICIENT DATA` (n<30 per bucket), expected at the 50-row API cap. Flows proxy at +60min on same session: `INVERTED` (262 graded).

## Blast radius

Read-only audit script only; no product behavior change.

> **kind:** FINDING

## Swing play-brief: lane rank wrong when multiple contracts share a ticker — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | C4 (identity), C7 (evidence) |

### Symptom

`computeLaneRank()` used `findIndex` on ticker only. When the same ticker had multiple WATCH contracts (e.g. NRG 110C vs 115C), rank/score/median were attributed to the first matching row — not the member's selected contract.

### Fix

Parse strike/right from the deck contract label (`110C · 13DTE`) and match lane peers by contract when disambiguating; fall back to ticker-only when contract cannot be parsed.

### Evidence

Regression tests in `play-brief-lane-rank.test.ts`.

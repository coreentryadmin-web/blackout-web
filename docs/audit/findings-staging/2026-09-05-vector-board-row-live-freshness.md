# 2026-09-05 — Vector board row live badge future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Area** | Night Hawk Vector board row liveness (`vectorBoardRowIsLive`) |
| **Status** | FIXED |

## Symptom

`vectorBoardRowIsLive` used raw `now - ts <= LIVE_MS`. A far-future `row.timestamp` reads as negative age, which always satisfies `<= 60_000` — the row stays "live" indefinitely.

## Fix

Route through `isWsUpdatedAtFresh(ts, LIVE_MS + 1, now)` so clock-skewed future stamps fail closed.

## Evidence

- `vector-board-row-utils.test.ts` — behavioral tests for in-window live, far-future not live, closed rows.

## RTH validation

- Vector board on `/nighthawk`: live badge on open rows still appears for rows updated within the last 60s during RTH.

# rth-open-check false RED on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-rth-open-holiday-skip |
| **Priority** | P2 |
| **Area** | CI / RTH validation |
| **Status** | FIXED |

## Symptom

`rth-open-check.yml` scheduled at 09:40 ET on Labor Day 2026-09-07 failed `open-check`
on main @7246d4dc even though prod was healthy — false RED on a market holiday.

## Root cause

Two gaps:

1. `rth-open-check.mjs` treated Labor Day as a normal weekday (`shouldAgentRun` only checks
   Sat/Sun) and ran the full RTH socket probe after 09:30.
2. `socket-health` correctly returns `{ ok: true, skipped: true }` on NYSE holidays (no
   `websockets` payload). `probeOptionsSocketWithRetries` saw HTTP 200 without
   `websockets.options` and exhausted retries → hard fail.

## Fix

- Early exit in `rth-open-check.mjs` when `!isTradingDayEt(sessionYmd)` (unless `--force`).
- Treat intentional holiday skip in `rth-socket-probe.mjs` as pass (covers `--force` runs too).

## Evidence

RED→GREEN: `node --test scripts/lib/rth-socket-probe.test.mjs`

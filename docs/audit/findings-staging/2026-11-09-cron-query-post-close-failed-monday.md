# Cron query false P0 — post-close `failed` handshakes on trading mornings — FIXED

> **kind:** `FINDING`

## Symptom

`scripts/cron-audit-query.mjs` (CI `query` job) RED on `main@1cc122c` at 2026-11-09 ~15:55 UTC (~10:55 ET Mon): `problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`.

## Root cause

`evaluateJob()` in `admin-cron-health.ts` suppressed stale/failed for **weekend** off-schedule gaps via `nonTradingScheduledIdle`, and suppressed **ok/skipped** handshakes during **weekday** off-schedule idle gaps — but a **`failed`** last handshake still surfaced as `failed` before the next UTC fire (ops #1983 trading-day half). Mon morning before 4:30 PM ET post-close bands, Fri’s failed row kept P0-ing `nighthawk-outcomes`, `gex-eod-snapshot`, and `banger-discovery`.

## Fix

Treat `failed` like `ok`/`skipped` when `isInOffScheduleIdleGap` (or dual-band await) is true; label as idle with “prior handshake failed” for admin visibility.

## Status

| **Status** | FIXED in PR (branch `cursor/autopilot-work-loop-aeaa`) |

## Market-open validation

- Mon ~10:55 ET: `npm run validate:cron` / watchdog `problem_keys` must not include the three post-close keys solely due to Fri `failed`.
- After each job’s post-close UTC band on a weekday, a new `failed` handshake must still P0.

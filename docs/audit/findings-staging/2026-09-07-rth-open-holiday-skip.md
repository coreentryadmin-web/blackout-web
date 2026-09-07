# RTH open-check false-fail on NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / rth-open-check |
| **PR** | fix/rth-open-holiday-skip (#4532) |

## Symptom

Labor Day 2026-09-07: scheduled `RTH open check` workflow failed on `main@7246d9ad` (`open-check` RED). The harness ran full RTH validation on a closed market day.

## Root cause

1. `rth-open-check.mjs` treated Monday holidays as normal weekdays — no early exit before `validate:deploy`.
2. On holidays, `data-correctness` logs `cron_job_runs.status = 'skipped'` while the harness only accepted `'ok'`.
3. Pre-#4523: `socket-health` returns `{ ok: true, skipped: true }` without `websockets.options`; inline probe read HTTP 200 as failure.

## Fix

- Early-exit on `!isTradingDayEt(sessionYmd)` unless `--force` (before post-deploy validation).
- Shared `isCronRunHealthyStatus()` accepts `ok` and `skipped` for data-correctness in `rth-open-check.mjs` and `gha-rth-audit.mjs`.
- Wire `rth-open-check` socket probe through `probeOptionsSocketWithRetries()` (holiday skip already handled post-#4523).

## Evidence

- `node --test scripts/rth-open-check.test.mjs scripts/lib/rth-socket-probe.test.mjs`
- Holiday gate static test: gate precedes `validate-deploy.mjs` in source order

## Market-open validation

Next NYSE holiday weekday: confirm scheduled `RTH open check` exits 0 with holiday skip log (no RED).

# RTH open-check false fail on NYSE holiday socket-health skip

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | ops / RTH validation |
| **Commit** | fix/rth-socket-probe-holiday-skip |

## Symptom

`RTH open check` workflow (`open-check` job) failed on Labor Day 2026-09-07 at 13:40 UTC even though production was healthy. Local `npm run validate:rth-open` reproduced: `options-socket (socket-health): probe HTTP 200` after three retries.

## Root cause

PR #4519+ gated `socket-health` on `isTradingDayEt` — on holidays the route correctly returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` without a `websockets.options` block. `probeOptionsSocketWithRetries()` treated missing `websockets.options` as a retryable miss and eventually failed with `probe HTTP 200`.

## Fix

Teach `probeOptionsSocketWithRetries()` to pass when `body.skipped === true && body.ok === true`. Refactored `rth-open-check.mjs` to use the shared helper (single code path with `validate-deploy.mjs`).

## Evidence

- RED: `npm run validate:rth-open` on 2026-09-07 14:24 ET → `probe HTTP 200` hard fail
- GREEN: `npx tsx --test scripts/lib/rth-socket-probe.test.mjs` including new holiday-skip case

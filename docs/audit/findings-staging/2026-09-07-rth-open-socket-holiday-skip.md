# RTH open-check false-fails on socket-health NYSE holiday skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `scripts/lib/rth-socket-probe.mjs`, `scripts/rth-open-check.mjs`, `scripts/validate-deploy.mjs` |

## Symptom

Labor Day 2026-09-07: `RTH open check` workflow (`open-check` job) failed on `main@7246d9ad` with
`options-socket: probe HTTP 200` after three retries — despite `socket-health` correctly returning
`{ ok: true, skipped: true, reason: "non-trading day (2026-09-07)" }` (shipped in #4520).

## Root cause

`probeOptionsSocketWithRetries` only looked for `body.websockets.options`. The holiday skip payload
has no `websockets` key, so HTTP 200 was misread as a missing probe and retried until failure.

## Fix

- `isSocketHealthHolidaySkip()` — detect `{ ok: true, skipped: true }`.
- `probeOptionsSocketWithRetries` treats holiday skip as immediate pass (success detail = `reason`).
- `rth-open-check.mjs` refactored to shared `probeOptionsSocketWithRetries` helper (same as deploy).

## Tests

`scripts/lib/rth-socket-probe.test.mjs` — holiday skip detection + probe pass case.

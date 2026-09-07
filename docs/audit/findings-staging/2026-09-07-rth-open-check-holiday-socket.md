# RTH-open check failed on Labor Day — socket-health holiday skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-rth-open-check-holiday-socket |
| **Priority** | P2 |
| **Area** | CI / RTH validation |
| **Status** | FIXED |

## Symptom

`open-check` workflow failed on `main@7246d9ad` (Labor Day 2026-09-07, 14:22 ET):

```
✗ options-socket: probe HTTP 200
```

`validate:deploy` passed; only `rth-open-check.mjs` hard-failed.

## Root cause

`socket-health` now returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }`
without a `websockets` block on NYSE holidays (#4520). `rth-open-check.mjs` had inline probe
logic that treated HTTP 200 without `websockets.options` as failure after 09:30 ET.
Postgres writer checks already skipped holidays via `isTradingDayEt`; the socket probe did not.

`validate-deploy.mjs` used shared `probeOptionsSocketWithRetries` with `hardFail: false` in GHA,
so deploy passed with a warn — but `rth-open-check` duplicated the probe without holiday handling.

## Fix

- `isSocketHealthHolidaySkip()` in `scripts/lib/rth-socket-probe.mjs` — recognizes holiday skip payload.
- `probeOptionsSocketWithRetries()` treats holiday skip as pass on first attempt.
- `rth-open-check.mjs` refactored to use shared probe helper (single code path with deploy validation).

## Blast radius

RTH-open CI + `npm run validate:rth-open` only. Trading-day socket auth checks unchanged.

## Evidence

`npx tsx --test scripts/lib/rth-socket-probe.test.mjs` — holiday skip test passes.
GHA `open-check` re-run on holiday should report `✓ options-socket: non-trading day (...)`.

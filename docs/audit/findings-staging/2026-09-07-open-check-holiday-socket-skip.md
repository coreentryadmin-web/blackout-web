# open-check false-fail on NYSE holidays — socket-health skip payload

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | `scripts/lib/rth-socket-probe.mjs`, `scripts/rth-open-check.mjs` |
| **Severity** | P1 — CI `open-check` red on Labor Day 2026-09-07 |

## Symptom

`rth-open-check.yml` failed on `main` at 09:40 ET Labor Day with:

`options-socket (socket-health): probe HTTP 200`

## Root cause

`GET /api/cron/socket-health` correctly skips on NYSE holidays (`isTradingDayEt`) and returns HTTP 200:

```json
{ "ok": true, "skipped": true, "reason": "non-trading day (2026-09-07)" }
```

No `websockets.options` key. `probeOptionsSocketWithRetries` treated bare HTTP 200 as failure after retries.

## Fix

Recognize `skipped: true` + non-trading-day reason as pass in shared probe helper; mirror in `rth-open-check.mjs` inline probe.

## Evidence

- RED→GREEN unit tests in `scripts/lib/rth-socket-probe.test.mjs`
- Repro: Labor Day 2026-09-07 `open-check` on commit `7246d9ad2`

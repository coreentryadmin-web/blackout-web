# RTH open-check false-red on NYSE holidays — socket-health skip payload

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|------------------------|
| **Area** | `scripts/lib/rth-socket-probe.mjs`, `scripts/rth-open-check.mjs` |
| **Severity** | P2 — CI false-red, not prod outage |

## Symptom

`RTH open check` workflow failed on **Labor Day 2026-09-07** (`main@7246d9ad`, run #34151354668):

```
✗ options-socket: probe HTTP 200
RTH-open FAILED (1)
```

## Root cause

After **#4517**, `/api/cron/socket-health` returns early on non-trading days:

```json
{ "ok": true, "skipped": true, "reason": "non-trading day (2026-09-07)" }
```

`rth-open-check.mjs` only accepted `body.websockets.options` or HTTP 401 — HTTP 200 without `websockets` was retried 3× then failed. Unrelated to **#4522** (admin cron stale thresholds).

## Fix

- `isSocketHealthNonTradingSkip()` + handling in `probeOptionsSocketWithRetries()` (shared with `validate-deploy.mjs`)
- Refactored `rth-open-check.mjs` to use the shared probe helper

## Evidence

- `scripts/lib/rth-socket-probe.test.mjs` — holiday skip passes on first attempt during RTH window
- Pre-fix: run #34151354668 log (3× HTTP 200, no websockets)

## Market-open validation

Tuesday 2026-09-08: confirm `RTH open check` workflow is green at 09:40 ET; on next NYSE holiday, workflow should pass with `options-socket: skipped (non-trading day ...)`.

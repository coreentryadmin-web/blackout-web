# socket-health holiday skip false-fails RTH open-check — FIXED

> **kind:** FINDING

| **Status** | FIXED in `fix/socket-health-holiday-probe` |
|------------|---------------------------------------------|

## Symptom

`RTH open check` workflow (`open-check` job) failed on Labor Day 2026-09-07 at 14:40 ET with:

```
options-socket (socket-health): probe HTTP 200
```

## Root cause

PR #4517 gated `socket-health` on `isTradingDayEt` — on NYSE holidays the route correctly returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` **without** a `websockets.options` block.

`validate-deploy.mjs` / `rth-open-check.mjs` probe logic only recognized `body.websockets?.options` or HTTP 401. A 200 holiday skip retried 3× then hard-failed.

## Fix

`isSocketHealthHolidaySkip()` in `scripts/lib/rth-socket-probe.mjs` — treat `ok && skipped` as pass in `probeOptionsSocketWithRetries` and `rth-open-check.mjs`.

## Evidence

- Local repro: `node scripts/rth-open-check.mjs` failed pre-fix on 2026-09-07 14:24 ET
- Unit test: holiday skip payload passes without `websockets` key

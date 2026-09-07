## 2026-09-07 — [P1, ops] RTH open-check false-failed on NYSE holidays when socket-health skips — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 — `open-check` workflow red on main every NYSE holiday at 09:40 ET |
| **Found by** | CI failure wake on `7246d9ad` (Labor Day 2026-09-07) |

### Root cause

`GET /api/cron/socket-health` correctly returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` on NYSE holidays (no `websockets` key). `probeOptionsSocketWithRetries` and the inline loop in `rth-open-check.mjs` treated HTTP 200 without `websockets.options` as retryable failure → 3 attempts → `probe HTTP 200` hard fail.

### Fix

- `rth-socket-probe.mjs`: pass immediately when `body.skipped === true && body.ok === true`.
- `rth-open-check.mjs`: delegate socket probe to shared `probeOptionsSocketWithRetries` (single code path with `validate-deploy`).

### Evidence

- `node --test scripts/lib/rth-socket-probe.test.mjs` — new holiday-skip test GREEN.
- Repro: Labor Day payload without `websockets` now passes in one attempt.

### RTH validation

Next NYSE holiday weekday: `rth-open-check.yml` should GREEN at 09:40 ET with log line `options-socket: skipped — non-trading day (...)`.

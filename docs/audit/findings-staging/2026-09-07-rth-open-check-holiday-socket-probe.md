## 2026-09-07 — [FINDING, P1 ops] RTH open-check false RED on NYSE holidays — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED — `socket-health` holiday skip payload recognized; socket probe no longer hard-fails after 09:30 ET on closed tape |
| **Priority** | P1 — scheduled `open-check` on main failed Labor Day 2026-09-07 |
| **Area** | `scripts/rth-open-check.mjs`, `scripts/validate-deploy.mjs`, `scripts/lib/rth-socket-probe.mjs` |
| **PR** | fix/rth-open-holiday-socket-probe |

## Root cause

On NYSE holidays `GET /api/cron/socket-health` returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` with **no** `websockets.options`. `probeOptionsSocketWithRetries` treated HTTP 200 without `options` as a retryable failure → `open-check` RED on Labor Day despite markets correctly closed.

## Fix

- `socketHealthNonTradingSkipReason()` + early pass in `probeOptionsSocketWithRetries`
- `validate-deploy` / `rth-open-check`: `afterOpen930` only applies on `isTradingDayEt` days

## Evidence

Local repro on 2026-09-07: `node scripts/rth-open-check.mjs --force` failed with `options-socket (socket-health): probe HTTP 200` before fix; passes after.

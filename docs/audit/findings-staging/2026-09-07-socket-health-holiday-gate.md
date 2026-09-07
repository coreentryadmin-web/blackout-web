# socket-health cron booted WS managers on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-socket-health-holiday-gate |
| **Priority** | P3 |
| **Area** | Cron infra / WebSocket health probe |
| **Status** | FIXED |

## Symptom

`GET /api/cron/socket-health` runs on weekday EventBridge schedule with no NYSE calendar gate.
On holidays it boots lazy data sockets via `ensureDataSockets()` and runs cluster health probes
against a closed tape — wasted WS churn and misleading off-hours health noise.

## Root cause

Route used `inOptionsMarketHours()` for reporting only; no `isTradingDayEt` skip before execution.

## Fix

`socket-health/route.ts`: after auth, skip with `{ ok: true, skipped: true }` when
`!isTradingDayEt(todayEt())` unless `force=1` (ops recovery bypass, same pattern as swing-discovery).

## Blast radius

socket-health cron only. RTH validation can still force a probe via `?force=1`.

## Evidence

RED→GREEN: `src/app/api/cron/socket-health/route.test.ts` — static gate ordering assertion.
`npx tsx --test src/app/api/cron/socket-health/route.test.ts` — pass.

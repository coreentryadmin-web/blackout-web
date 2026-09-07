# validate:deploy false-fail on NYSE holiday socket-health skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / validate:deploy |
| **PR** | fix/validate-deploy-socket-health-holiday-skip |

## Symptom

On Labor Day 2026-09-07, `npm run validate:deploy` hard-failed §5 with `options-socket (socket-health): probe HTTP 200` while `npm run blackout:rth-lifecycle` otherwise reported platform GREEN. `GET /api/cron/socket-health` correctly returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` per #4517 — no `websockets` payload.

## Root cause

`probeOptionsSocketWithRetries()` treated HTTP 200 without `websockets.options` as a retryable failure. Holiday skip is intentional, not a missing health payload.

## Fix

Recognize `ok && skipped` socket-health responses as pass in the shared probe helper; mirror in `rth-open-check.mjs` inline loop.

## Evidence

- `node --test scripts/lib/rth-socket-probe.test.mjs` — holiday skip regression passes
- Pre-fix: validate:deploy §5 FAIL on 2026-09-07 Labor Day

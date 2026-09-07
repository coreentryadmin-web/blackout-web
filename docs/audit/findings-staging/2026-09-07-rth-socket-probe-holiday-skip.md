# validate:deploy false-RED on socket-health holiday skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P2 |
| **Area** | ops / validate:deploy |
| **PR** | fix/rth-socket-probe-holiday-skip |

## Symptom

After #4517 gated `socket-health` on `isTradingDayEt`, Labor Day returns `{ ok: true, skipped: true, reason: "non-trading day (...)" }` with HTTP 200 and **no** `websockets.options`. `probeOptionsSocketWithRetries` treated missing options as `probe HTTP 200` failure → `validate:deploy` RED.

## Fix

Treat `body.ok && body.skipped` as a successful probe with detail from `reason`.

## Evidence

- `npx tsx --test scripts/lib/rth-socket-probe.test.mjs` — holiday skip regression passes

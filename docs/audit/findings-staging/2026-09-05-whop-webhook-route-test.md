> **kind:** FINDING

# 2026-09-05-whop-webhook-route-test — FIXED

| Field | Value |
|-------|-------|
| **ID** | CCQ-012 / BO-P1-0101 |
| **Pri** | P1 |
| **Status** | FIXED |
| **PR** | (this PR) |

## What was broken

`POST /api/webhook/whop` had no route-level test for `whop.webhooks.unwrap()` signature failure or the missing-`WHOP_WEBHOOK_SECRET` fail-closed paths. Lib-level Whop helpers were tested; the route's 400/503 branches were not (flagged in Phase 5 CCQ-012).

## Fix

Added `src/app/api/webhook/whop/route.test.ts` with three hermetic route tests:
- invalid signature → HTTP 400 + `invalid_webhook_signature` telemetry
- missing secret in production → HTTP 503 retryable
- missing secret in non-production → HTTP 200 warning ack

## Evidence

```
node --import tsx --experimental-test-module-mocks --test src/app/api/webhook/whop/route.test.ts
# 3 pass / 0 fail
```

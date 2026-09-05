# 2026-09-05 — Whop webhook route signature test (CCQ-012)

> **kind:** FINDING

## Summary

Cross-examination round (CCQ-012 / CQ-170) flagged that `src/app/api/webhook/whop/route.ts` had **no route-level test** for `whop.webhooks.unwrap()` failure paths, while the sibling Clerk webhook route already had `route.test.ts`.

## Root cause

Whop billing logic was covered by lib-level tests (`whop-dunning`, `whop-revocation`, etc.) but the HTTP route's fail-closed gates (invalid signature → 400, missing secret → 503 in prod) were untested at the route boundary.

## Fix

- Added `src/app/api/webhook/whop/route.test.ts` with 3 cases:
  1. Invalid Standard Webhooks signature → **400** + `invalid_webhook_signature` telemetry
  2. Missing `WHOP_WEBHOOK_SECRET` in non-production → **200** warning (dev convenience)
  3. Missing `WHOP_WEBHOOK_SECRET` in production → **503** retryable (Whop retries)
- Added `npm run seo:generate-marketing-dates` script (CCQ-018 follow-up wiring)

## Evidence

```bash
node --import tsx --experimental-test-module-mocks --test src/app/api/webhook/whop/route.test.ts
# 3 pass / 0 fail
```

| **Status** | FIXED in PR |

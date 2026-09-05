> **kind:** FINDING

## Whop billing webhook route lacked signature-failure test — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 security coverage |
| **Source** | CCQ-012 / CQ-170 (Phase 5 cross-exam) |

## Root cause

`POST /api/webhook/whop` verifies payloads via `whop.webhooks.unwrap()` and returns HTTP 400 on
signature failure, but no route-level hermetic test existed — unlike the sibling Clerk webhook.

## Fix

Added `src/app/api/webhook/whop/route.test.ts`: invalid signature → 400 (never reaches sync);
missing secret in production → 503 retryable + ops alert; missing secret in dev → 200 warning.

## Tests

`npm test` collects `src/app/api/webhook/whop/route.test.ts` — 3/3 pass.

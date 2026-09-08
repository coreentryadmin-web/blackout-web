> **kind:** FINDING

## Post-Whop-pay tier lag — no desk “processing payment” UX — FIXED (banner + auto-sync)

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 conversion |
| **CLQ** | CLQ-041 |

## Fix

`MembershipActivatingBanner` in `AppShellProviders`: when `readRememberedPlan()` is fresh (post-`CheckoutLink` click) and Clerk tier is still free, show top banner and poll `POST /api/membership/sync` every 3s (~2 min) until paid tier lands.

## Tests

- `membership-activating.test.ts` (5/5)
- `MembershipActivatingBanner.test.ts` (2/2)

## Deferred

Synthetic upgrade p95 measurement — not run this session.

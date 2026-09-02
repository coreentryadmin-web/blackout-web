## 2026-09-02 — [FINDING, P2 billing] Whop dunning-grace is Redis-only and fails open toward REVOKING access — the hourly reconcile cron can persist the downgrade — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What this resolves** | The 2026-09-01 entry `[FINDING, P2 billing] Whop dunning-grace is Redis-only and fails open toward REVOKING access — the hourly reconcile cron can persist the downgrade — OPEN`, which characterized the bug and proposed mirroring `whop-revocation.ts`'s dual Postgres+Redis pattern but deferred the fix to the billing lane. |
| **Root cause** | `isMembershipInDunningGrace` (`whop-dunning.ts`) read only Redis; any miss (TTL expiry, transient ETIMEDOUT, post-deploy cold cache) returned false, so `resolveTierFromMembership` downgraded legitimately `past_due` members inside webhook-granted grace to `free`. The hourly `membership-reconcile` cron could persist that downgrade to Clerk `publicMetadata`. |
| **Fix** | Mirrored `whop-revocation.ts` exactly: new `whop_dunning_grace(membership_id, expires_at)` Postgres table in `ensureSchema()`; `markMembershipDunningGrace` dual-writes (Redis hot path + Postgres `expires_at`); `clearMembershipDunningGrace` deletes from both; `isMembershipInDunningGrace` falls through to `expires_at > NOW()` on a Redis miss and backfills the hot cache (positive with remaining TTL, negative with 10m TTL). Throws on mark only when BOTH stores fail (webhook retry path). |
| **Regression guard** | `src/lib/__tests__/whop-dunning-grace.test.ts` — 9 tests covering Redis hit/miss, expired Postgres rows, negative backfill, dual-write/clear, and db-not-configured degradation. |
| **Gates** | `npx tsc --noEmit` clean · `whop-dunning-grace.test.ts` 9/9 · full `npm test` (Node 20). |
| **Status** | FIXED. |

# 2026-09-05 — SSE recheck used stale JWT tier claims — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P1 security / entitlement |
| **Found by** | Peer review of #3905 vs merged #3895 |
| **Status** | FIXED — `recheckSseUserEntitlement` now calls `resolveUserTier(userId)` without session JWT claims |

## Root cause

#3895 added per-tick SSE entitlement recheck via `requireTierApi()` → `auth()` + `resolveUserTier(userId, sessionClaims)`. After `publishTierChanged` evicts the tier cache, `resolveUserTier` still short-circuits on stale JWT `tier: premium` (`tier-cache.ts` L139–141) without a Clerk re-fetch — so a Whop-cancelled member could keep receiving live marks/vector/flows SSE until session JWT refresh.

## Fix

- `src/lib/sse-stream-entitlement.ts` — userId-only `resolveUserTier` / `userCanAccessTool`; returns `ok | forbidden | unavailable`
- marks/vector/flows streams: forbidden → SSE `event: error` + close; unavailable → skip tick (fail-open)

## Test

`src/lib/sse-stream-entitlement-revalidate.test.ts` — behavioral RED→GREEN for tier drop, tool revoke, admin bypass, transient outage.

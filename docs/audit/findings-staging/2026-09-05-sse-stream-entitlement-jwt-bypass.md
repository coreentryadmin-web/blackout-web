# 2026-09-05 — SSE entitlement recheck still used stale JWT claims — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P1 security / entitlement |
| **Found by** | Cursor peer review of #3905 (superseded by #3895) |
| **Status** | FIXED — `recheckSseUserEntitlement(userId)` calls `resolveUserTier(userId)` without session JWT claims |

## Root cause

#3895 added per-tick SSE entitlement recheck via `recheckSseUserEntitlement`, but it delegated to `requireTierApi` / `requireToolApi`, which call `auth()` and pass `sessionClaims` into `resolveUserTier`. A Whop cancellation that evicts the tier cache but leaves a stale premium JWT could still pass mid-stream rechecks.

## Fix

- `src/lib/sse-stream-entitlement.ts` — resolve tier/tool by `userId` only (no JWT claims); return `ok` | `forbidden` | `unavailable`
- All three SSE routes (`zerodte/marks`, `vector`, `flows`) pass captured `streamUserId`; forbidden closes with SSE error event; unavailable skips tick (fail-open)

## Test

`src/lib/sse-stream-entitlement-revalidate.test.ts` — behavioral RED→GREEN (5 cases)

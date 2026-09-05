# 2026-09-05 — SSE stream tier recheck trusted stale JWT claims after Whop cancellation (Q41 follow-up)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | SSE streams (`zerodte/marks`, `vector`, `flows`) — mid-session entitlement |
| **Status** | FIXED |

## Symptom

Merged #3895 added per-tick `recheckSseUserEntitlement`, but it routed through `requireTierApi()` →
`resolveUserTier(userId, sessionClaims)`. When JWT still carries `tier=premium` after a Whop
cancellation, `tier-cache.ts` short-circuits on claims without a Clerk fetch — a lapsed member
kept receiving live premium SSE frames until session JWT refresh.

## Root cause

Connect-time and tick-time recheck used the same JWT-fast-path. `publishTierChanged` evicts the
in-memory cache, but the next tick still trusts stale session claims.

## Fix

`recheckSseUserEntitlement(userId, minTier, tool?)` now calls `resolveUserTier(userId)` with no
session claims, plus `userCanAccessTool(userId, tool)` when a tool key is supplied. Transient tier
outages fail open (`unavailable` → skip tick); real entitlement loss closes with an SSE `event: error`.

## Evidence

- `npx tsx --test src/lib/sse-stream-entitlement-revalidate.test.ts` — 5/5 pass (Whop cancel, tool revoke, outage fail-open).
- Source-scan tests updated for all three stream routes.

## RTH validation

- Open a long-lived marks/vector/flows SSE tab as premium; simulate tier drop (admin metadata or test user) — stream should cut within one tick with `Forbidden — upgrade required`.

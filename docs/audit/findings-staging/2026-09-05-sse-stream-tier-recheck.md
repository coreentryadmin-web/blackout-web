# 2026-09-05 — SSE premium streams never re-check tier after connect — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P1 security / entitlement |
| **Found by** | Swing deep-dive Q41 (`docs/audit/SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md`) |
| **Status** | FIXED — `revalidateSseStreamAccess` on each SSE tick for zerodte marks + vector streams |

## Root cause

`GET /api/market/zerodte/marks/stream` and `GET /api/market/vector/stream` called `authorizeCronOrTierApi` / `authorizePremiumDeskApi` once at connection-open, then pushed data every 1s for the life of the tab with no subsequent entitlement check. A member whose Whop subscription lapsed mid-session kept receiving live position P&L (swing rows ride the marks frame) until manually closing the tab.

## Fix

- `src/lib/sse-stream-auth.ts` — shared `revalidateSseStreamAccess()` (no JWT claims; honors `publishTierChanged` cache eviction)
- Wired into both stream routes; forbidden → SSE `event: error` + close; unavailable → skip tick (fail-open for transient Clerk)

## Test

`src/lib/sse-stream-auth.test.ts` — static guard that both routes call `revalidateSseStreamAccess`.

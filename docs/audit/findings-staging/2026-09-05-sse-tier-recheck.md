# 2026-09-05 — SSE premium streams never re-check tier after connect

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 (entitlement / live-money data leak) |
| **Area** | `zerodte/marks/stream`, `vector/stream` |
| **Status** | FIXED |

## Symptom

Long-lived SSE connections (`setInterval` ~1s) ran `authorizeCronOrTierApi` / `requireToolApi` **once at connect** only. A member whose Whop subscription lapsed mid-session kept receiving live swing/0DTE/banger marks and Vector frames until manually closing the tab.

## Root cause

Auth was modeled as one-shot HTTP gate, not a connection lifecycle gate. `publishTierChanged` evicts tier cache on cancellation, but the stream never called `resolveUserTier` again.

## Fix

- `src/lib/sse-desk-stream-auth.ts` — `recheckUserSseDeskAccess()` re-runs `requireTierApi` + `requireToolApiForDeskCaller` each tick for user callers; cron callers unchanged.
- Wired into `zerodte/marks/stream/route.ts` and `vector/stream/route.ts`.
- Source-scan regression: `sse-desk-stream-auth.test.ts`.

## Evidence

- Identified in swing deep-dive Q41 (#3889); verified against live route source before fix.
- `npx tsx --test src/lib/sse-desk-stream-auth.test.ts` GREEN.

## RTH validation

- Open Night Hawk with live marks SSE; confirm stream still delivers ticks for premium admin.
- Simulate tier downgrade (temp user + Whop webhook or metadata change) — stream should stop within one tick (~1s).

# 2026-09-05-swing-mark-asof-sse-tier-recheck.md

> **kind:** FINDING

## Swing Q40/Q41 — live mark freshness + SSE tier revocation

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swing desk + premium SSE streams |
| **PR** | #3895 |

### Root cause

**Q41:** `/api/market/zerodte/marks/stream` and `/api/market/vector/stream` checked tier/tool access only at connection open. A member whose Whop subscription lapsed mid-session kept receiving live swing + 0DTE P&L until the tab closed, even though `publishTierChanged` had evicted their cached tier.

**Q40:** `swing_positions.last_mark_at` and manage-snapshot `quote.asOf` were persisted but dropped in `livePlayFromSwingPosition` → `HorizonDeck` → `terminalPlayFromHorizon`, so swing rows depended on incidental 0DTE SSE coverage for staleness UI.

### Fix

- `recheckSseUserEntitlement()` on every user SSE tick (cron streams unchanged).
- `HorizonPlay.markAsOf` wired from `last_mark_at` with `quote.asOf` fallback; passed through `containers.tsx`.

### Evidence

- `npx tsx --test src/lib/sse-stream-entitlement.test.ts`
- `npx tsx --test src/lib/swing/live-plays.test.ts` (Q40 cases)

### RTH validation

- Open `/nighthawk` Swing lane with an OPEN position — detail terminal should show STALE chip when `last_mark_at` is old (without relying on 0DTE SSE).
- Tier revocation: cancel test member mid-session → SSE stream should close within one tick; REST poll already 403s.

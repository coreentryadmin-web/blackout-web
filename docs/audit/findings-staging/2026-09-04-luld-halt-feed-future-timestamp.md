# LULD halt feed future-timestamp staleness guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | ingest / admin health |
| **PR** | (this branch) |

## Symptom

`isLuldHaltFeedStale` used `Date.now() - at > maxAgeMs`. A clock-skewed **future** `last_message_at` yields negative age, so the feed reads as live when it should be flagged stale.

## Fix

Use `!isWsUpdatedAtFresh(at, maxAgeMs)` from `timestamp-freshness.ts`.

## Evidence

- `src/lib/ws/luld-halts-store.test.ts`
- `npx tsx --test src/lib/ws/luld-halts-store.test.ts`

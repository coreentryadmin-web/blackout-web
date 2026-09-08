# 2026-09-04 — LULD halt future-timestamp freshness guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | Massive LULD halt gate (`stocks-socket.ts`, `luld-halts-store.ts`) |
| **Status** | FIXED |

## Symptom

`isLuldHaltSourceStaleForState()` and `isLuldHaltFeedStale()` used raw `Date.now() - timestamp` age math without a future-timestamp guard. A clock-skewed future `clusterMessageAt`, `localFreshestAt`, or `last_message_at` produced a negative age that passed the `<= maxAgeMs` check, so the halt gate read **live/trusted** when the stamp was untrustworthy — the opposite of the UW halt fix shipped earlier the same day (#3745).

## Root cause

LULD staleness paths were not migrated when UW halt staleness moved to shared `isWsUpdatedAtFresh`.

## Fix

- `isLuldHaltSourceStaleForState`: gate all three freshness probes through `isWsUpdatedAtFresh`.
- `isLuldHaltFeedStale`: replace raw subtraction with `!isWsUpdatedAtFresh(at, maxAgeMs)`.

## Evidence

- `stocks-socket.test.ts` — future cluster/local timestamp regressions.
- `luld-halt-freshness.test.ts` — source-scan guards mirroring `uw-socket-gate.test.ts`.

## RTH validation

- Admin System Vitals → Massive LULD tile should still show live during RTH when the feed is healthy.
- Confirm 0DTE board halt gate blocks entries when **both** UW and LULD sources are genuinely down (not on a single future-skewed stamp).

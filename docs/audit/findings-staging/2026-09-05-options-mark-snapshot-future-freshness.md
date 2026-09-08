# 2026-09-05 — Options WS async mark + warmed snapshot cache future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Area** | 0DTE live marks (`getLiveOptionMark`), option snapshot cache reader |
| **Status** | FIXED |

## Symptom

`getLiveOptionMarkSync` already routed through `isWsUpdatedAtFresh`, but the async twin
(`getLiveOptionMark`) and `getOptionSnapshot` still used raw `now - ts <= maxAgeMs`. A
future-skewed quote stamp reads as age 0 → falsely fresh, blocking REST/snapshot fallback.

## Root cause

Partial migration during the incremental freshness sweep (#3926 family): sync hot path fixed,
async + Redis read paths missed.

## Fix

- `options-socket.ts` — `getLiveOptionMark` local + Redis hits use `isWsUpdatedAtFresh(ts, maxAgeMs, now)`.
- `options-snapshot.ts` — `getOptionSnapshot` local + Redis hits use `isWsUpdatedAtFresh(ts, SNAP_FRESH_MS, now)`.

## Evidence

- `options-socket-gate.test.ts` — extended source-scan guard (no raw `now - ts` in mark reader).
- `options-snapshot-freshness.test.ts` — source-scan guard for snapshot cache.

## RTH validation

- 0DTE board live marks: SSE marks advance each tick; stale/future WS quote falls back to snapshot.
- Legacy marks route: no pinned stale mid when WS stamp is clock-skewed forward.

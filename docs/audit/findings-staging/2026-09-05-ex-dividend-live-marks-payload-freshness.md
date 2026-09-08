# 2026-09-05 — Swing ex-dividend cache + 0DTE live-marks payload memo future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Area** | Swing Q39 ex-dividend structural stop, 0DTE live marks SSE frame memo |
| **Status** | FIXED |

## Symptom

Two sibling caches still used raw `Date.now() - at` comparisons after the incremental `isWsUpdatedAtFresh` migration:

- `resolveSwingExDividendContext` (`ex-dividend-reads.ts`) — 6h session cache for Q39 structural-stop adjustment.
- `getZeroDteLiveMarksFrame` payload memo (`live-marks.ts`) — ~900ms per-tick frame dedupe for SSE/REST.

A far-future `at` reads as infinitely fresh: ex-dividend context could skip refetch for 6h; payload memo could pin a stale marks frame across ticks.

## Root cause

Pattern-scan follow-on after #3926; lower blast radius than Vector/GEX paths but same defect class.

## Fix

- `ex-dividend-reads.ts` — route cache hit through `isWsUpdatedAtFresh(hit.at, CACHE_TTL_MS, now)`.
- `live-marks.ts` — payload memo uses `isWsUpdatedAtFresh(payloadMemo.builtAt, PAYLOAD_MEMO_MS + 1, now)` (preserves prior `<= PAYLOAD_MEMO_MS` semantics).

## Evidence

- `ex-dividend-reads-freshness.test.ts` — source-scan guard.
- `live-marks-active-cache-freshness.test.ts` — extended for payload memo.

## RTH validation

- Swing structural stop on an ex-dividend name: Q39 adjustment should still resolve after deploy (no behavior change under normal clocks).
- 0DTE live marks SSE: frame `as_of` should advance each ~1s tick; no pinned memo across multiple ticks after cache skew.

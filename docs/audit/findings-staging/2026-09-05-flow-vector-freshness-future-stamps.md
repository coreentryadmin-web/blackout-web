# Flow + Vector board freshness — future timestamp false-fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-freshness-2026-09-05 |
| **Status** | FIXED |
| **Area** | flow-data-freshness, vector-board-row-utils, largo product-reads |
| **PR** | (pending) |

## Symptom

Clock-skewed or bad-source future timestamps read as age `0` via raw `now - ts` or `Math.max(0, now - ts)`, pinning caches and live badges as falsely fresh.

## Root cause

- `vectorBoardRowIsLive` used `now - ts <= LIVE_MS` with no future guard.
- `flow-data-freshness` clamped negative age to `0` and accepted future stamps up to +60s on `markFlowDataFresh`.
- `product-reads.ageSecondsFrom` and `helix-thermal-compare.ageSecondsFromIso` duplicated `Math.max(0, …)` without skew tolerance.

## Fix

- Vector board live badge → `isWsUpdatedAtFresh(ts, LIVE_MS, now)`.
- Flow age helpers → shared `flowAgeMsFromStamp` with `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; tighten `markFlowDataFresh` reject window.
- Largo age helpers → delegate to `ageSecFromIso` from `timestamp-freshness.ts`.

## Evidence

- `vector-board-row-utils.test.ts` — future row not live.
- `flow-data-freshness.test.ts` — future tape returns null; far-future mark ignored.
- Freshness guard source scans for regression pins.

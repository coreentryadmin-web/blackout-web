# 2026-09-04 — Vector API roundFloats + UW halt freshness guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 (roundFloats) / P1 (halt freshness) |
| **Area** | Vector API routes, UW WebSocket halt gate |
| **Status** | FIXED |

## Symptom

1. Five Vector cache-reader routes returned raw IEEE floats at the JSON boundary (`7499.360000000001`-class noise), while sibling Vector routes already call `roundFloats`.
2. `isUwHaltSourceStale()` used `Date.now() - freshest > maxAgeMs` without a future-timestamp guard — a clock-skewed future `effectiveFreshestUwMessageAt()` reads as **live/trusted**, opposite of `isUwChannelFresh`.

## Root cause

- `vector/universe`, `wall-history`, `daily-regime`, `rail-bootstrap`, and `contract-picks` were missed when `walls/route.ts` was fixed for the same defect.
- Halt staleness proxy reused raw age math instead of shared `isWsUpdatedAtFresh`.

## Fix

- Wrap all five route responses with `roundFloats(...)`.
- Replace halt proxy check with `!isWsUpdatedAtFresh(freshest, maxAgeMs)`.

## Evidence

- Source-scan tests: `vector-roundfloats-routes.test.ts`, `daily-regime/route.test.ts`, `uw-socket-gate.test.ts`.
- Pattern scan from hourly checklist (`npm run blackout:hourly` §3).

## RTH validation

- Poll `/api/market/vector/universe` and `/api/market/vector/daily-regime?ticker=SPX` — numeric fields should be 2dp, no long float tails.
- During RTH, confirm halt gate still blocks entries when UW socket is genuinely down (admin System Vitals / 0DTE board).

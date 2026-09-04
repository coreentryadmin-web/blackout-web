# 2026-09-04 — WS future-timestamp freshness guards — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P1 — future-dated timestamps read as infinitely fresh, defeating staleness gates |
| **Surfaces** | `getLiveOptionMarkSync` (0DTE marks, vector-pick-sweep), `isUwChannelFresh` / halt staleness (SPX desk, flow ingest), SPX pulse SSE local snapshot, Thermal Triple Desk change% header |
| **Status** | FIXED |

### Root cause

Several hot-path freshness checks used raw `Date.now() - ts <= maxAge` without rejecting
clock-skewed future timestamps. A negative age never exceeds a positive stale threshold, so
corrupted future-dated marks/channels read as fresh.

### Fix

- `getLiveOptionMarkSync` → `isZeroDteMarkStale` (same guard as Night Hawk board)
- `isUwChannelFresh` / `isUwHaltSourceStale` → `isWsUpdatedAtFresh`
- SPX pulse stream local snapshot → `isWsUpdatedAtFresh`
- `ThermalTripleDesk` header change% → `rebaseChangePct` when live push spot overlays matrix snapshot

### Regression guard

`src/lib/ws/options-socket-mark-freshness.test.ts` — future-dated mark rejected, recent mark returned.

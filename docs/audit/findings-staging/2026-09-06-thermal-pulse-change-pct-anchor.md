# Thermal pulse SSE change_pct session-open anchor — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-thermal-pulse-change-pct |
| **Priority** | P1 |
| **Area** | Thermal `/heatmap` header, pulse SSE, polygon indexStore |
| **Status** | FIXED in `fix/thermal-pulse-change-pct-anchor` |

## Symptom

Thermal `/heatmap` header could show SPX/VIX day-change measured from session open (ws-bar anchor) instead of prior close when the pulse SSE overlay won over the REST quote — same failure class as the 2026-08-07 SPX desk P0. `usePulseStream` was already fixed; `GexHeatmap` called `createPulseEventSource` directly and fell back to raw `pushedChangePct`.

## Root cause

Three layers:

1. `polygon-socket.ts` recomputed `change_pct` on every V tick from `session_open` even when `open_source === "ws-bar"`.
2. `/api/market/spx/pulse/stream` serialized `indexStore` verbatim without the REST-anchor gate used by `/spx/pulse`.
3. `GexHeatmap.tsx` trusted transported `pulseSnap[pulseField].change_pct` as a header fallback.

## Fix

- V ticks: only recompute `change_pct` when `open_source === "rest"`.
- Pulse SSE: `sanitizeIndexWire()` via `clusterIndexSpotChangePct`.
- GexHeatmap: `pulseChangePctFromPriorClose` (SPX) + `restAnchoredIndexChangePct` (VIX); removed raw pulse fallback.

## Evidence

- Source scans: `GexHeatmap-header-change-pct.test.ts`, `route.test.ts`, `polygon-socket-change-pct.test.ts`
- RTH validate: Thermal header SPX/VIX change% matches desk pulse on next open

# Cluster health future-skew + VIX SSE change% gate — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-cluster-vix-sse |
| **Pri** | P2 |
| **Status** | FIXED |
| **PR** | (pending) |

## Symptom

1. **socket-cluster-health**: `buildUwClusterHealth` / `readPolygonClusterHealth` used `Math.max(0, now - at)` without a future-skew guard. A clock-skewed future `updatedAt` read as age `0` → `cluster_live: true` on web-tier followers while `uw-socket.ts` already used `isWsUpdatedAtFresh`.

2. **usePulseStream SSE overlay**: `vix_change_pct` was transported verbatim from the pulse stream. When the upstream anchor was `ws-bar` (session open), VIX day-change could disagree with the REST-derived desk value — same failure class as the 2026-08-07 SPX P0, but VIX has no prior close to derive from.

## Fix

- Route cluster liveness through `isWsUpdatedAtFresh` + `wsUpdatedAtAgeMs` (matches `uw-socket.ts` / `options-socket.ts`).
- Add `restAnchoredIndexChangePct()` and gate VIX SSE overlay on `open_source === "rest"`, falling back to the REST pulse value.

## Evidence

- `socket-cluster-health.test.ts`: future heartbeat → `cluster_live: false`
- `spx-change-anchor.test.ts` + `usePulseStream.test.ts`: ws-bar VIX change% rejected, REST anchor accepted

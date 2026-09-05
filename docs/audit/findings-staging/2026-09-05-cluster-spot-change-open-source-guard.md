> **kind:** FINDING

## Cluster index spot change_pct served without open_source guard — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P1 — wrong day-change% on GEX/Thermal when web replica reads Redis cluster snapshot |
| **Area** | `readClusterIndexSpot` → `resolveSpotSnapshot` redis_cluster path |

### Root cause

`readClusterIndexSpot()` returned `change_pct` from `spx:pulse:snapshot` whenever finite, without checking `open_source`. Sibling paths (`liveWsIndexSpot`, SPX desk merge) already null change% when anchor is `ws-bar`. Web-tier GEX cache readers hitting the cluster fallback could show live price + session-open–anchored change%.

### Fix

`clusterIndexSpotChangePct()` — only returns change% when `open_source === "rest"`. Wired in `readClusterIndexSpot`.

### Validate at RTH

Thermal SPX matrix header change% vs SPX desk pulse on a cold web replica (or force cluster path) — both should agree or show honest absence, never diverge on anchor basis.

# Swing Largo — HELIX stale absence + Vector counter-thesis — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | (pending) |
| **Area** | Ask Largo / swing play-brief |
| **Priority** | P2 |

## What was broken

1. **C3 absence:** `collectBriefUnavailableSources` only flagged HELIX stale when `recent_flow` was present — stale pipeline with no cached aggregate stayed silent in `UnavailableChip`.
2. **C2/C3 intel:** `flowIntelSection` rendered cached `recent_anomalies` and `flow_full_state.recent` even when `flow_feed_fresh === false`.
3. **Cross-desk narrative:** `counterThesisLine` omitted Vector `play.bias` conflicts already surfaced by `crossDeskCoaching` (#4208).

## Fix

- Flag HELIX stale whenever `flow_feed_fresh === false`
- Gate anomalies/prints behind `flow_feed_fresh !== false`
- Add Vector bearish/bullish to counter-thesis steelman

## Market-open check

Night Hawk Swings → Ask Largo on a ticker with stale HELIX: envelope should show HELIX unavailable chip; flow section must not list recent prints.

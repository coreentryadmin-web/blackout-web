# 2026-09-04 — FlowAnomalyBanner future-dated anomaly recency

> **kind:** FINDING

## Symptom

A `detectedAt` timestamp from the future (DB/upstream clock skew) made `isRecent()` return true indefinitely because `Date.now() - future < RECENCY_MS` for any realistic skew — flashing the HELIX Flow Anomalies banner for events that have not occurred yet.

## Root cause

`FlowAnomalyBanner.tsx` compared raw age with no future guard, unlike sibling freshness helpers fixed 2026-09-03 across GexHeatmap, meridian-viz, and coaching alerts.

## Fix

Extracted `isFlowAnomalyRecent()` in `flow-anomaly-recency.ts`; future skew returns `false` (not recent).

## Status

FIXED in PR.

## Market-open validation

On `/flows` during RTH, confirm Flow Anomaly banner only appears for anomalies within the last 15 minutes and does not flash on stale/future rows after a deploy.

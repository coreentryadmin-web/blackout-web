# 2026-09-04 — Flow liveness heartbeat future-dated freshness

> **kind:** FINDING

## Symptom

A flow-ingest REST-skip gate or admin HELIX health panel could treat a future-dated cluster heartbeat as fresh indefinitely because `Date.now() - future <= maxAgeMs` is always true for negative age.

## Root cause

`isFlowFrameFreshFromCluster`, `isFlowFrameFreshAnywhere`, and `peekFlowLivenessHeartbeat` compared raw age without rejecting future timestamps — unlike sibling freshness helpers fixed 2026-09-03 across GEX cache, FlowAnomalyBanner, and data-integrity verifiers.

## Fix

Extracted `isHeartbeatAtFresh()` requiring `ageMs >= 0 && ageMs <= maxAgeMs`; all three readers use it.

## Status

FIXED in PR.

## Market-open validation

During RTH, `/admin` HELIX health: flow heartbeat `fresh` should flip false when heartbeat is stale, and must not stay green on a future-dated stamp after a cross-replica clock skew event.

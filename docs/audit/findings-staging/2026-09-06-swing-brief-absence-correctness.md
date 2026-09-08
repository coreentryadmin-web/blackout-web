# 2026-09-06-swing-brief-absence-correctness.md

> **kind:** FINDING

## Swing play-brief — stale HELIX flow, SHORT break-watch, silent open-book failure

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | (this branch) |

### What was broken

1. **Stale HELIX flow treated as live** — when `flow_feed_fresh === false`, the brief still emitted call/put coaching, flow evidence, and `flowSnapshot` diffs. Violates Largo C2/C3.
2. **SHORT break-watch used `target_premium`** — profit rail quoted as invalidation instead of `stop_premium` (loss rail), inverting cover coaching.
3. **`openBook` DB failure → `[]`** — `fetchOpenSwingPositions().catch(() => [])` made ledger read failures indistinguishable from an empty book, suppressing concentration warnings.

### Fix

- `play-brief-absence.ts`: `trustedHelixFlow()` + `collectBriefUnavailableSources()`
- Context loader returns `null` on book fetch failure; envelope surfaces `unavailableSources`
- Narrative SHORT fallback uses `stop_premium`

### Verify at RTH

- Open a swing play with stale HELIX feed → brief shows `UnavailableChip` for HELIX flow, no call-heavy coaching
- SHORT open play without GEX walls → break watch cites stop premium, not target

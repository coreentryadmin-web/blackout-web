> **kind:** FINDING

## Desk enrichment UW fan-out missing background sweep tag — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | SPX desk / UW rate limiter |
| **Branch** | `fix/desk-enrichment-uw-sweep` |

### Root cause

`fetchDeskEnrichmentFields()` in `spx-desk.ts` fans out to five UW REST endpoints via `runUwPooled`, but was not tagged with `runWithBackgroundUwSweep`. Desk-touching crons (`spx-evaluate`, `spx-signal-observe`, `market-regime-detector`, `data-correctness`) call `loadMergedSpxDesk()` which can trigger `scheduleDeskEnrichmentRefresh()` on a stale sticky — consuming UW concurrency without reserving a background slot, unlike `desk-warm` which already wraps the same path.

### Fix

Wrap `fetchDeskEnrichmentFields` body in `runWithBackgroundUwSweep` at the single fan-out site so all callers inherit the tag.

### Evidence

- Source-scan regression: `spx-desk-enrichment-uw-sweep.test.ts` (2 tests, RED pre-fix / GREEN post-fix)
- Pattern scan 2026-09-05 hourly wake

### Blast radius

All desk enrichment refresh paths (async sticky refresh + `prefetchSpxDeskEnrichment` from desk-warm). Nested inside desk-warm's existing sweep tag — AsyncLocalStorage is idempotent.

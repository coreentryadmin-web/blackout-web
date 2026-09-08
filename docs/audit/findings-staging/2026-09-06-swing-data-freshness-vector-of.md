> **kind:** FINDING

## Swing dataFreshnessSection ignored ecosystem Vector fallback — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | LARGO C2 (freshness) |

### Symptom

`dataFreshnessSection` read `ctx.vector` directly while every other intel path uses `vectorOf(ctx)`. When standalone Vector fetch failed but `ecosystem.vector_full_state` still carried stale levels, the brief rendered Vector data without the `dataAgeMs > 120s` staleness warning.

### Fix

Use `vectorOf(ctx)` in `dataFreshnessSection` — same helper as `buildIntelSections` and `dataHonestyCoaching`.

### Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts` — 16/16 pass including new regression test.

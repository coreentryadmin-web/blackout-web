# Largo C2 — stale GEX focal levels in trade-manager Break watch

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|------------------------|
| **Area** | Night Hawk Swings / Ask Largo (`tradeManagerNarrativeSection`) |
| **PR** | fix/largo-gex-stale-focal-levels |

## Symptom

`collectFocalLevels` and the standalone `flip` passed to `breakTrigger` cited gamma flip and put/call wall levels from `eco.gex_positioning` with no staleness gate when Vector data was absent — the same Largo contract point 2 (freshness) violation fixed in #4360/#4364 for `gexPostureSection` and `counterThesisLine`, and in #4367 for `watchForSection`.

A stale GEX-only put wall could produce a **Break watch — lose 98.00** line off a snapshot minutes old.

## Fix

Per-side stale GEX gating (mirrors #4364/#4367):

- `collectFocalLevels`: suppress put wall, call wall, gamma flip, and GEX-king focal nodes when sourced from stale GEX-only fallback
- `tradeManagerNarrativeSection`: suppress stale GEX-only flip in `breakTrigger` fallback path

Live Vector-sourced levels still render even when the GEX matrix is stale.

## Evidence

- `npx tsx --test src/lib/swing/play-brief-narrative.test.ts` — three new stale-parity cases RED pre-fix, GREEN post-fix
- `npx tsc --noEmit` — clean

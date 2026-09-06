> **kind:** FINDING

## Stale GEX spot leaked in levels sections + envelope spot level — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-spot-levels |
| **Pri** | P2 |
| **Area** | Ask Largo / Night Hawk Swings |
| **Status** | FIXED (PR pending) |

### Symptom

`chartLevelsSection`, `watchForSection`, and `levelsFromContext` resolved spot as `vec?.spot ?? gex?.spot` without nulling stale GEX spot — stale matrix spot could drive wall distance formatting or enable flip-watch lines when Vector was also stale.

### Root cause

#4411/#4415 gated walls/flip/narrative spot but left the same `?? gex?.spot` fallback unguarded in level-formatting paths.

### Fix

Gate `gex?.spot` with `gexMatrixStale()` at each spot resolution site (mirror #4415 narrative fix).

### Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts`

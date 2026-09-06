> **kind:** FINDING

## Stale GEX spot leaked in narrative + coaching omitted GEX matrix age — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-gex-stale-spot |
| **Pri** | P2 |
| **Area** | Ask Largo / Night Hawk Swings |
| **Status** | FIXED (PR pending) |

### Symptom

`tradeManagerNarrativeSection` null-gated stale Vector spot but still fell through to `gex_positioning.spot` when the GEX matrix was stale — printing `Spot **100.00**` in the unresolved-posture line without a freshness caveat. `dataHonestyCoaching` warned on Vector age and HELIX pipeline but not stale GEX matrix (though `dataFreshnessSection` already did).

### Root cause

#4411 gated walls/flip/posture from stale GEX but left spot resolution as `vec?.spot ?? gex?.spot` without a `gexMatrixStale` guard on the fallback.

### Fix

- Null `gex?.spot` at source when `gexMatrixStale()` in narrative spot resolution.
- Mirror `dataFreshnessSection` GEX age warning in `dataHonestyCoaching`.

### Evidence

`npx tsx --test src/lib/swing/play-brief-narrative.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts`

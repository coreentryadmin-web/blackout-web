# Largo C2 — stale Vector coaching bullets + narrative paths not gated

> **kind:** FINDING

## Symptom

After #4400–#4402 gated envelope levels, intel sections, and desk reads, seven Vector coaching helpers and three trade-manager narrative paths still grounded directional claims from snapshots >120s old:

- `magnetCoaching`, `expectedMoveCoaching`, `confluenceCoaching`, `wallIntegrityCoaching`, `vexCoaching`, `flowPrintsCoaching`, `wallDynamicsCoaching`
- `wallDynamicsSection` (intel panel)
- `tradeManagerNarrativeSection` proximity / wall-event bullets and stale gamma-flip in break-watch path

## Fix

Early `return null` (or omit stale Vector fields) when `vectorSnapshotStale(vec, Date.now())` at each call site — same 120s bound as the rest of Largo C2.

## Evidence

```
npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts \
  src/lib/swing/play-brief-narrative.test.ts \
  src/lib/swing/play-brief-intel.test.ts
→ all pass (Node 20)
```

| **Status** | FIXED in fix/largo-stale-vector-coaching-consolidated |

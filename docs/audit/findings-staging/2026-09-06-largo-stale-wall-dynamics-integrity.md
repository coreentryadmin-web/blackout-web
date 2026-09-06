# Largo C2 — stale Vector wall dynamics/integrity coaching not gated

> **kind:** FINDING

## Symptom

When `vectorSnapshotStale()` is true (>120s), swing play-brief still rendered:

- `wallDynamicsSection` — bead events from a stale snapshot
- `wallIntegrityCoaching` — thin/firm wall coaching from stale data
- `wallDynamicsCoaching` — structure-shift coaching from stale events

Same class as #4400/#4402 (stale Vector chart/desk/walls) but these three call sites were missed.

## Fix

Early `return null` when `vectorSnapshotStale(vec, Date.now())` in all three functions.

## Evidence

```
npx tsx --test src/lib/swing/play-brief-intel.test.ts \
  src/lib/swing/play-brief-narrative-coaching.test.ts
→ 82/82 pass (Node 20)
```

| **Status** | FIXED in fix/largo-stale-wall-dynamics-coaching |

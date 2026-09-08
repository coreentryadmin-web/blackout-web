> **kind:** `FINDING`

## Catalysts short-volume ratio rendered 2500–6900% — percent-scale upstream value double-scaled — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (data-correctness — fabricated impossible percentages on every live swing brief) |
| **Area** | Night Hawk Swings — Ask Largo `catalystsSection` via `assembleEcosystemArsenal` |
| **PR** | (pending) |

### Symptom

`catalystsSection` renders `short vol ratio **${(f.short_volume_ratio * 100).toFixed(0)}%**`, assuming a 0–1 fraction. Live envelopes showed **2494%–6913%** on every ticker (CRWD 6913%, AAPL 5250%, etc.) — evidence the stored value was already on a 0–100 percent scale (~69) and got multiplied again. Audit finding #12 (`SWING-SYSTEM-CTO-AUDIT-2026-09-06.md`).

### Root cause

`fetchTickerFundamentalsBundle` already normalizes via `normalizeShortVolumeRatio`, but **stale `bie:ticker-fundamentals:v1` cache entries** and any direct bundle passthrough in `assembleEcosystemArsenal` could still surface unnormalized percent-scale values to the arsenal slice.

### Fix

1. Apply `normalizeShortVolumeRatio` at `assembleEcosystemArsenal` when copying `short_volume_ratio` (defense in depth for all ecosystem consumers).
2. Bump fundamentals cache key `v1` → `v2` so stale unnormalized rows age out.

### Evidence

- `assembleEcosystemArsenal` test: raw `69.13` → stored `0.6913`
- `catalystsSection` test: `0.6913` fraction → renders `69%`, not `6913%`
- `npx tsx --test src/lib/bie/ecosystem-context.test.ts src/lib/swing/play-brief-intel.test.ts`

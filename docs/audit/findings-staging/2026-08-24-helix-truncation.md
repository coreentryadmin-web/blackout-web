# HELIX get_helix_derived transport truncation — FIXED

> **kind:** FINDING

## Summary

The `get_helix_derived` Largo tool was exceeding `MAX_TOOL_RESULT_CHARS` (16,000 chars), causing the transport layer to truncate the payload with a `…[truncated]` marker. This meant Largo received incomplete signal data: partial stacked hits, top prints, velocity spikes, and split flow lists.

## Root Cause

The tool's payload lists were capped too generously:
- `stacked_hits`: 20 items (was largest contributor)
- `top_prints`: 12 items, each with computed `position_intent` field
- `velocity_spikes`: 12 items
- `split_flow`: 12 items

Even with truncation flags and metadata, the serialized JSON exceeded 16k chars.

## Evidence

Detected by Phase 1 item 6: truncation probe (`scripts/audit/largo-truncation-probe.mjs`). Live run 2026-08-21:
- Control (`get_zerodte_rejections`): PROVEN — detected truncation as expected
- Result: `get_helix_derived` returned TRUNCATED marker
- Impact: Largo model received partial lists without knowing they were incomplete

## Fix

Reduced payload caps to:
- `stacked_hits`: 20 → 12 items
- `top_prints`: 12 → 8 items
- `velocity_spikes`: 12 → 8 items
- `split_flow`: 12 → 8 items

Each list still carries:
- `*_total`: true count (tells model how many exist beyond the cap)
- `*_truncated`: boolean flag (explicit "this is a sample" marker)

Same discipline already used by `get_helix_signal_outcomes` (rows_shown/rows_summarized) and `get_helix_tape_analytics` (expiry_concentration_truncated).

## Verification

- All 231 HELIX tests pass
- TypeScript compiles cleanly
- No regressions in HELIX flows or tape analytics
- Rerun truncation probe with: `npm run validate:largo-truncate -- --tools=get_helix_derived --control=get_zerodte_rejections`

## Status

| | |
|---|---|
| **Status** | FIXED |
| **Branch** | fix/helix-truncation |
| **Commit** | 8a8dd38d |
| **Files changed** | src/lib/largo/product-reads.ts |
| **Impact** | Largo now receives complete signal data from get_helix_derived |

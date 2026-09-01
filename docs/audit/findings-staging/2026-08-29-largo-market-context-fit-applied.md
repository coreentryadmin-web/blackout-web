# 2026-08-29 — Largo `get_market_context` tool fitting applied — FIXED

> **kind:** `FINDING`

## Summary

The `get_market_context` Largo tool was previously marked ANALYZING for truncation risk (2026-08-23). PR #3038 applied `fitSpxStructureForModel` to the `spx_desk` field, reducing its payload size. Re-probe on 2026-08-29 confirms the tool now returns COMPLETE payloads without truncation.

| **Date** | **Event** | **Result** |
|---|---|---|
| 2026-08-23 | Truncation probe | TRUNCATED |
| 2026-08-28 07:43 UTC | PR #3038 merged | Applied fitSpxStructureForModel |
| 2026-08-29 | Full truncation sweep | COMPLETE ✓ |

## Fix Applied

**PR #3038 change:**
- Location: `src/lib/largo/run-tool.ts` line ~754-762, case `"get_market_context"`
- Change: Wrap `spxSummary` with `fitSpxStructureForModel()` before inclusion in returned payload
- Pattern: Product-first data preserved (full data in Night Hawk edition builder); Largo-specific fitting applied only at tool boundary

```typescript
const fittedSpx = spxSummary ? fitSpxStructureForModel(spxSummary).fitted : null;
```

## Result

- Before: Payload exceeded 16,384 bytes, JSON truncated, model received `[truncated]` marker
- After: Payload ~14,200 bytes after fitting, fits within transport cap, model receives COMPLETE payload

## Root Cause

The `spx_desk` field of `get_market_context` returned full SPX desk summary including optional fields (news_headlines, macro_events, sector_heat, oi_changes, unified_tape, greek_exposure, macro_indicators, strike_stacks) that Largo questions don't use. Fitting removed these fields while preserving core data.

## Status

**Status: FIXED** (verified COMPLETE on live production as of 2026-08-29 07:XX UTC).

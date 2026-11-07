# SPX Desk: Data Quality Contradiction on VIX After Sticky Cache Merge

**Date:** 2026-11-07  
**Kind:** FINDING  
**Status:** FIXED

## Summary
The SPX desk's `data_quality.missing` array reported "VIX" as unavailable even when the final merged desk's `vix` field carried a real, fresh sticky-cached value (e.g., 24.6). Members reading the desk state and checking data-quality metadata saw contradictory signals: the vix field present but the missing array claiming it was absent.

## Root Cause
`buildDeskDataQuality()` (spx-desk.ts:886) is called early in the merge pipeline against raw snapshots before sticky-cache substitution is applied. If raw snaps have `vix <= 0`, the function marks "VIX" as missing. Later, `mergePulseIntoDesk()` applies sticky `vix` substitution via `stickyStructureLevel()`, but the already-computed `data_quality` object is never updated to reflect the newly-populated field.

**Blast radius:** Every desk snapshot where raw fetches returned null/empty VIX but a sticky-cached value existed. Member reading the desk state received contradictory metadata (field present, quality says absent).

## Fix
Add `repairDataQualityAfterMerge()` helper (spx-desk-merge.ts) that checks the final merged vix and removes "VIX" from `data_quality.missing` if it is now live (>0):

1. **spx-desk-merge.ts**: Added `repairDataQualityAfterMerge()` function that accepts merged desk and returns corrected desk with "VIX" removed from missing if vix is now live
2. **spx-desk-merge.ts**: Integrated call to `repairDataQualityAfterMerge()` at the end of `mergeDeskLayers()`, after all merge operations complete
3. **spx-desk-merge.test.ts**: Added regression test verifying data_quality.missing no longer contradicts vix field after sticky substitution

**Backward compatibility:** Purely defensive — only removes a contradiction, never fabricates data.

## Evidence
- Regression test: "removes VIX from data_quality.missing when sticky cache provides live value"
- Test creates desk with `vix:null, data_quality.missing:["VIX"]` and pulse with sticky `vix:24.6`
- After merge via `mergePulseIntoDesk()`, asserts `vix===24.6` and `!"VIX" in data_quality.missing`
- Test passes with fix applied

## Files Changed
- `src/features/spx/lib/spx-desk-merge.ts`: Added `repairDataQualityAfterMerge()`, integrated into `mergeDeskLayers()`
- `src/features/spx/lib/spx-desk-merge.test.ts`: Added regression test

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Urd7n4TkQUjnsmhb3PPq9U

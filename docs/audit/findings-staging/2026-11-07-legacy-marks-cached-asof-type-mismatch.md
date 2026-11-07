# Legacy Marks Cache Fallback — CachedLegacyMark.asof Type Mismatch Broke `main` — FIXED

> **kind:** FINDING

## Symptom
`npx tsc --noEmit` fails on `main` with two real type errors in `src/features/nighthawk/lib/legacy-option-marks-server.ts`:
- Line 74 (TS2352): a cast of `{ ..., asof: string | null }` to `CachedLegacyMark` rejected — the declared type did not overlap with the real shape.
- Line 89 (TS2322): assigning `cached.asof` (declared `number`) to `row.asof` (`string | null`) rejected.

**How this landed on `main`:** PR #7517 ("fix(nighthawk): legacy option marks cache fallback on provider failure") was merged by the authoring session at 18:56:49 UTC, 8 seconds after this repo's `verify` CI check reported `conclusion: failure` on that exact head SHA (`78c8729`) — the job log shows `tsc --noEmit` failing with these same two errors. The merge went through despite the failing required check.

## Root Cause
The new `CachedLegacyMark` type declared `asof: number`, but the value it actually stores and reads is `row.asof` from `buildLegacyOptionMarkRow()`, which returns `asof: string | null` (an ISO-8601 timestamp string, not a numeric epoch). The author worked around the resulting cast error at the write site with `as CachedLegacyMark` (an unsafe assertion that papered over the real mismatch) but the read-site assignment (`row.asof = cached.asof`) had no such escape hatch and failed to compile.

## Blast Radius
Confined to this one file/type — `CachedLegacyMark` is not exported or used elsewhere (`grep -rn "CachedLegacyMark"` shows only this file). No other caller of `fetchLegacyOptionMarksServer()` is affected by the type itself; the risk was purely that `main` carried a non-compiling commit until this fix landed.

## Fix Rationale
Changed `CachedLegacyMark.asof` from `number` to `string | null` to match the real value it holds, and replaced the unsafe `as CachedLegacyMark` cast at the write site with a plain typed object literal (`const toCache: CachedLegacyMark = {...}`) so the compiler verifies the shape structurally instead of being told to trust it. No behavior change — `row.asof` was always a string already; only the type declaration was wrong.

**Why not revert #7517 instead:** the underlying cache-fallback feature is real and wanted (positions were dropping from the Legacy board on provider outages); reverting would re-introduce that bug. The type error was a narrow, mechanical mismatch with an obvious one-line fix, not a logic defect in the feature itself.

| Before | After |
|--------|-------|
| `asof: number` in `CachedLegacyMark`, unsafe `as` cast at write site | `asof: string | null`, structurally-checked literal at write site |
| `tsc --noEmit` fails on `main` | `tsc --noEmit` clean |

## Evidence
- `npx tsc --noEmit` (Node 20) reproduced both errors against `main` at commit `098d84a08` before this fix, clean after.
- Existing regression tests in `legacy-option-marks-server.test.ts` (2/2) still pass — they predate this fix and don't exercise the compiled-type boundary, which is exactly how this slipped through; a stronger behavioral test (mocking WS+REST failure and asserting the cache round-trip, including `asof`) is a worthwhile follow-up, flagged separately to the nighthawk lane.

## Process note
This is a live instance of the CLAUDE.md "MIRROR FAILURE" pattern (self-authored PR merging past its own failing required check) — the merge event and the check-failure event for the same head SHA arrived within an 8-second window. Not something fixable from this repo's application code; worth re-raising if it recurs, same as the existing documented instances.

| **Status** | Fixed in PR (this commit) |

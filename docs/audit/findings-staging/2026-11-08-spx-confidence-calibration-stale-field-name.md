# `scripts/audit/spx-confidence-calibration.mjs` silently went blind after the `confidence` → `rawScore` rename

> **kind:** FINDING

## Summary
`scripts/audit/spx-confidence-calibration.mjs` measures whether SPX Slayer's entry-time score field is calibrated against realized outcomes — it's the tool that originally found (2026-08-23, `docs/audit/FINDINGS.md`) that the field saturates to a constant `96` across 51/51 real closed plays. PR #2791 ("Rename confidence field to rawScore") later renamed the live field on `GET /api/market/spx/outcomes` from `confidence` to `rawScore` as the deliberate member-facing labeling fix for that same finding — but this script was never updated to follow the rename, so every run since then silently read `r.confidence` (undefined on every row) instead of `r.rawScore`.

## Evidence
- Before the fix: `node scripts/audit/spx-confidence-calibration.mjs --days=131 --json` against production reported `confidence_information: {n: 0, distinct_values: 0, constant: null, uninformative: true}` — indistinguishable from "no plays closed this window," even though 51 real closed plays exist in that window (`closed_plays: 51` in the same output, from `grade_rank`/`abs_score` correlations which read different, unrenamed fields correctly at `n=51`).
- Independently confirmed live via a direct `GET /api/market/spx/outcomes?days=90` fetch: every row carries `rawScore: 96`, no `confidence` key at all.
- After the fix: the same command reports `raw_score_information: {n: 51, distinct_values: 1, constant: 96, uninformative: true}` and the `96-100` calibration bucket correctly shows `n: 51, wins: 28, win_rate: 0.549` — reproducing the original 2026-08-23 finding exactly (same constant, same ~55% realized win rate), just measured at a slightly wider window.

## Root cause
Three field reads in the script (`r.confidence` at the `informationCheck` call, the `confidence` predictor, and the `bucketCalibration` value accessor) were never updated when the live API's field name changed. `informationCheck` has a correct code path for "the field is a real constant" but no code path for "the field doesn't exist" — both read as `n: 0`, which looks like an empty dataset rather than a renamed one. This is a pure tooling regression: the underlying rawScore saturation finding itself was never wrong, this script just stopped being able to see it.

## Fix
Renamed every `r.confidence` read to `r.rawScore`, renamed the `confidence` predictor key to `rawScore`, and renamed the output's `confidence_information` key to `raw_score_information` plus updated the console-output text ("confidence" → "rawScore", "{n}% conviction" → "{n} Score") to match the member-facing relabeling that was already shipped elsewhere. No change to `lib/calibration-eval.mjs`'s pure helpers — they were already correct; only this script's field-name assumption was stale.

## Validation
RED (before): `confidence_information: {n:0, uninformative:true, constant:null}` against a live window with 51 real closed plays.
GREEN (after): `raw_score_information: {n:51, uninformative:true, constant:96}`, bucket `96-100: n=51, wins=28, win_rate=0.549` — matches the original 2026-08-23 measurement.
`npx tsc --noEmit` clean (plain `.mjs`, no type changes needed).

## Blast radius
Single file. No other script imports `spx-confidence-calibration.mjs`'s internals — `lib/calibration-eval.mjs`'s own unit tests (`calibration-eval.test.mjs`, pure helpers) are unaffected since the bug was never in that shared library, only in this script's own field accessor.

| **Status** | FIXED — this PR. |

# PR feedback triage stuck on "CI pending" after green verify

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **PR** | (pending) |
| **Area** | autopilot / pr-feedback |

## Root cause

`summarizeChecks()` in `scripts/blackout-agent/pr-feedback.mjs` only read CheckRun `conclusion` fields. `gh pr checks --json` returns `state: "SUCCESS"` (and `bucket: "pass"`) with no `conclusion`, so `verify` always looked pending and `deriveDirective()` never advanced past **WAIT — CI pending** even after green CI.

## Evidence

PR #3492: `gh pr checks` showed `verify pass`, but `npm run blackout:pr-sweep` and manual `ci_completed` triage still posted WAIT. Reproduced locally: checks with `{ state: "SUCCESS" }` yielded `verify.conclusion` undefined.

## Fix

`checkConclusion()` normalizes both gh CLI (`state`/`bucket`) and API (`conclusion`) shapes; `summarizeChecks()` attaches normalized `conclusion` before filtering.

## Tests

`scripts/blackout-agent/pr-feedback.test.mjs` — 2 new cases; 16/16 pass.

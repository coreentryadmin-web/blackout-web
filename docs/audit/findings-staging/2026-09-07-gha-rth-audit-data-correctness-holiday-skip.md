# gha-rth-audit's data-correctness check has no holiday guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P3 |
| **Area** | ops / RTH deep-audit GHA workflow |
| **PR** | fix/gha-rth-audit-data-correctness-holiday-skip |

## Symptom

`scripts/gha-rth-audit.mjs` (run by `.github/workflows/rth-deep-audit.yml` on a fixed
`0 14/15 * * 1-5` UTC schedule — Mon–Fri, no NYSE holiday awareness at the schedule level) checks
the latest `data-correctness` `cron_job_runs` row and only accepts `status === "ok"`. On a NYSE
weekday holiday, `data-correctness` correctly logs `status="skipped"` (per the holiday-gate wave
landed today across #4517–#4523) — this check has no `if (tradingDay)` guard around it (unlike the
three sibling Postgres checks in the same function, which are correctly guarded), so it fails
unconditionally.

Same bug class as today's `rth-open-check.mjs` holiday-gate wave (#4517–#4523, #4549), found while
reviewing the parallel `fix/rth-open-holiday-early-exit` (#4549) and `fix/rth-open-holiday-skip-no-retry-noise`
(#4547) PRs — #4549's early-exit fix only covers `rth-open-check.mjs`; this is the same
class of defect in the separate `gha-rth-audit.mjs` harness, which has no equivalent early exit and
was not touched by any of today's other holiday-gate PRs.

## Root cause

`gha-rth-audit.mjs`'s `data-correctness` status check (line ~106) runs unconditionally, unlike the
`spx-evaluate`/`market_regime`/writer-cron checks a few lines above it which are correctly gated by
`if (tradingDay)`. It was never updated to accept the legitimate `skipped` status.

## Fix

Added `isCronRunHealthyStatus(status)` to the shared `scripts/lib/rth-socket-probe.mjs` (`ok` or
`skipped` both pass — mirrors the naming/location precedent from the parallel `rth-open-check.mjs`
fix), and used it in `gha-rth-audit.mjs`'s `data-correctness` check.

## Blast radius

`scripts/gha-rth-audit.mjs` only (the `rth-deep-audit.yml` workflow's Postgres audit section). No
production cron/route behavior changed — audit-tooling verdict only.

## Evidence

RED: confirmed live against `origin/main` — `git show origin/main:scripts/gha-rth-audit.mjs | grep
data-correctness` shows the unconditional `status === "ok"` check with no `tradingDay` guard, and
the workflow's own schedule (`0 14 * * 1-5` / `0 15 * * 1-5`) has no NYSE-holiday exemption, so it
runs and fails on every future holiday weekday.

GREEN: `node --test scripts/lib/rth-socket-probe.test.mjs` — 10/10 pass, including the new
`isCronRunHealthyStatus: accepts ok and skipped, rejects everything else` case. `node --check
scripts/gha-rth-audit.mjs` / `scripts/lib/rth-socket-probe.mjs` — syntax valid.

Verified in an isolated git worktree, not the shared main checkout.

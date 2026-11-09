# RTH deep audit false RED after 16:15 ET

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## Symptom

Scheduled `RTH deep audit` run 42718407755 (2026-11-09 23:12 UTC / 18:12 ET) failed `audit` despite closed cash session: P0 SPX spot 0, empty heatmaps, indices 502, and `cron-watchdog: swing-discovery`.

## Root cause

`gha-rth-audit.mjs` always ran `full-site-deep-audit.mjs` and failed on any `problem_keys`, even when `inRthOpenWindow()` was false. Late-scheduled runs (Actions queue delay past 16:15 ET) treated honest off-hours empty desk/heatmap payloads as P0 and post-close cron idle problems as hard fails.

## Fix

- Skip full-site deep audit off RTH unless `--force` (same posture as Postgres writer checks).
- Cron watchdog off-hours: fail only `rth_stale_keys`; log other `problem_keys` as warnings.

## Verify

- `npx tsx --test scripts/lib/gha-rth-audit-offhours-eval.test.ts`
- Next scheduled `RTH deep audit` after 16:15 ET should stay GREEN unless `rth_stale_keys` non-empty.

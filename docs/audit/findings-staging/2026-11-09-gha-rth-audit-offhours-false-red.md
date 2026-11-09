# GHA RTH deep audit false red post-close (full-site + swing-discovery watchdog) — FIXED

> **kind:** FINDING

| **Status** | FIXED |

## What broke

`RTH deep audit` / branch check **audit** failed on `main` (run **42718407755**, Mon **18:12 ET** post-close): full-site P0 SPX `spot=0`, empty heatmaps, and `cron-watchdog: swing-discovery` while cash session was closed.

## Root cause

`scripts/gha-rth-audit.mjs` always ran `full-site-deep-audit.mjs` and failed the run when `cron-staleness-watchdog` returned any `problem_keys`, even off-hours when quotes/crons are expected idle or phase-anchored jobs (POST_CLOSE still open) legitimately show handshake failures.

## Fix

- Skip full-site deep audit unless `inRthOpenWindow()` (09:00–16:15 ET) or `--force`.
- Cron-watchdog: fail in-window on any `problem_keys`; off-hours only on `rth_stale_keys` or `error_spike === "critical"`; log other problems as non-blocking warnings.

## Verify

`node --test scripts/gha-rth-audit-cron-watchdog.test.mjs`

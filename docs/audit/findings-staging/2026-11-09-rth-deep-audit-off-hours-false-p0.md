# RTH deep audit false-red after bell (SPX spot 0 + swing-discovery)

> **kind:** FINDING

| **Status** | FIXED |
| --- | --- |

## Symptom

Scheduled **RTH deep audit** failed (run **42718407755**, `ebb16827`) at **Mon 18:12 ET** with:

- P0 `[spx-desk] SPOT: spot missing or invalid: 0`
- `cron-watchdog: swing-discovery`

The workflow's 20:30/21:30 UTC crons target **4:30 PM ET**, which is **outside** `inRthOpenWindow` (09:00–16:15 ET).

## Root cause

`full-site-deep-audit.mjs` and `gha-rth-audit.mjs` treated post-close runs like mid-RTH: desk `price: 0` and non-`market_hours_only` cron staleness (e.g. swing-discovery POST_CLOSE) failed the job even when Postgres RTH checks were intentionally skipped as off-hours.

## Fix

- Desk snapshot: off-hours warn-pass on missing spot (same discipline as deploy smoke).
- Watchdog: off-hours only `rth_stale_keys` gate CI; in-RTH still uses full `problem_keys`.
- Heatmap/snapshot: unavailable off-hours → expected pass, not P1 noise.

## Evidence

GHA log lines above; `node --test scripts/full-site-deep-audit.test.mjs`.

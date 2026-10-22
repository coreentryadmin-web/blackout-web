# swing-discovery cron audit false RED while serving snapshot fresh

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — scheduled `Cron audit query` noise |
| **Discovered** | 2026-10-22 runs 39812996844 / 39813170535 |

## Symptom

`npm run validate:cron` / `cron-audit-query.yml` failed with `problems: swing-discovery` during RTH while `npm run healthcheck:swing` was GREEN (serving snapshot live, 62 open positions).

## Root cause

Phase-anchored `swing-discovery` can leave a `failed` or `stale` `cron_job_runs` handshake (ALB abort, idempotent skip storms, deploy gap) even after `persistSwingServingSnapshot` succeeded. The watchdog only read `cron_job_runs`; it never probed `swing:serving:latest:v1`, the authoritative member target.

## Fix

- `swing-discovery-cron-health.ts` — pure serving-snapshot freshness check (session day + `stale_after_min` ceiling).
- `probeWriterTargetFresh("swing-discovery")` — wire the probe.
- `admin-cron-health.ts` — include `swing-discovery` in target-fresh overrides; treat `failed` handshake as overridable when the snapshot is fresh.

## Evidence

Run 39813170535 at 16:20 UTC (`problems: swing-discovery`); live `healthcheck:swing` GREEN same window.

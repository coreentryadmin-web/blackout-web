# swing-discovery cron health — serving snapshot probe + self-heal dispatch

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — Cron audit query / watchdog false positive vs real lane outage |
| **Discovered** | 2026-10-22 Cron audit query runs 39812996844 / 39813170535 |

## Symptom

`Cron audit query` on `main` failed with `problems: swing-discovery` via HTTP watchdog fallback while other crons were healthy.

## Root cause

`swing-discovery` is phase-anchored: most EventBridge firings are intentional skips, but the **authoritative member artifact** is `swing:serving:latest:v1` (written only on a successful phase scan). The health board treated **`cron_job_runs` handshake age alone** as stale after 36h with no phase/serving cross-check — so a quiet `cron_job_runs` tail (e.g. last row ~36h old) pages even when the serving snapshot still reflects today's session, and conversely a genuinely dark lane (snapshot `sessionDay` lagging) must stay red.

## Fix

- `probeSwingDiscoveryServingSnapshot()` + `probeWriterTargetFresh("swing-discovery")` — downgrade handshake-only staleness when the serving snapshot matches the expected ET session/phases.
- Register `swing-discovery` in `CRON_DISPATCH` (`force:1` ops recovery) and include stale `swing-discovery` in watchdog self-heal targets.

## Verify

After deploy: `node scripts/cron-audit-query.mjs` GREEN when serving snapshot is current; stays RED when `sessionDay` lags during RTH. Watchdog self-heal (when enabled) re-dispatches stale `swing-discovery`.

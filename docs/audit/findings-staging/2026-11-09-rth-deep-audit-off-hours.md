# RTH deep audit false RED off-hours (spot 0 + swing-discovery handshake) — FIXED

> **kind:** `FINDING`

## Symptom

`RTH deep audit` job `audit` failed on `main@ebb16827` (~18:12 ET Mon): full-site P0 `spx-desk` spot 0, heatmap empty, `/api/market/indices` 502; cron-watchdog `swing-discovery` stale.

## Root cause

1. **Full-site** still ran after the 16:15 ET RTH grace window and treated missing live spot/GEX as P0 (unlike deploy smoke’s off-hours desk policy).
2. **swing-discovery** used the registry’s flat **36h** `stale_after_min` in `effectiveStaleMinutes`, shorter than `swingDiscoveryHandshakeStaleMin()` (~60h Fri POST_CLOSE → Mon POST_CLOSE gap), so the handshake looked stale Monday evening before POST_CLOSE re-fired even when the serving snapshot could still be valid.

## Fix

- `gha-rth-audit.mjs`: skip full-site deep audit when `!inRthOpenWindow()`.
- `full-site-deep-audit.mjs`: off cash RTH, lenient SPX desk spot + heatmap (via `isApproxUsCashRth`).
- `admin-cron-health.ts`: `effectiveStaleMinutes` for `swing-discovery` uses `swingDiscoveryHandshakeStaleMin()`.

## Status

| **Status** | FIXED (branch `cursor/autopilot-work-loop-aeaa`) |

## Market-open validation

- During RTH (10:00 / 14:00 scheduled deep audits): full-site still runs; SPX spot P0 and stale handshake ceiling behave as before.
- Post-16:15 ET scheduled run: audit should not fail on spot=0 alone; `swing-discovery` should not page on Fri→Mon gap under ~60h.

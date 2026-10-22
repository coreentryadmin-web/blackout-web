# swing-discovery MIDDAY failed at ~20s client abort — FIXED

> **kind:** FINDING

| **Status** | FIXED (pending deploy) |
|------------|------------------------|

## Root cause

`GET /api/cron/swing-discovery` awaited the full whole-market scan on the HTTP request thread. During RTH, UW admission queueing plus Polygon fan-out routinely exceeds ~20s. When the cron HTTP client disconnected (AbortError: "The operation was aborted due to timeout"), in-flight provider work aborted, `logCronRun` recorded `failed`, and `cron-audit-query` exited 1 on `swing-discovery` even though `claim_released: true` allowed retries.

Live 2026-10-22 ~16:04 UTC: MIDDAY phase, `duration_ms: 20640`, message `"The operation was aborted due to timeout"`.

## Fix

Mirror `zerodte-warm` / `bie-full-state-snapshot`: after the atomic phase claim, dispatch `runSwingDiscoveryPhaseJob` via `runWithBackgroundUwSweep` + fire-and-forget, return **202 accepted** with an immediate `logCronRun` handshake. Phase-claim release on failure remains in the background task's `catch`.

## Verify after deploy

- `GET /api/admin/cron-health` → `swing-discovery` last status `ok` (accepted or completed background row).
- `npm run validate:cron` / Cron audit query workflow GREEN on `main`.
- CloudWatch: `[cron/swing-discovery]` completes MIDDAY without 20s abort during RTH.

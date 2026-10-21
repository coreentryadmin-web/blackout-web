> **kind:** FINDING

## zerodte-warm RTH stale — RVOL shadow Polygon fetch could hang entire scan — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `Cron audit query` failed on `main` (`66691d75`) — watchdog reported `zerodte-warm` stale during RTH (listed twice: `problem_keys` + `rth_stale_keys`).

**Root cause:** `admin-cron-health.ts` overrides `zerodte-warm` to **stale** when `zerodte_scan_heartbeat` is `critical_stale` (>10m since `recordZeroDteScanTick`), even if `cron_job_runs` handshakes look fresh. `recordZeroDteScanTick` runs only after `scanZeroDteBoard()` returns. New RVOL shadow wiring (`computeRelativeVolumeShadow` in `relative-volume-source.ts`) uses Polygon minute/daily fetches with **no timeout**; `Promise.allSettled` in `scan.ts` still waits forever if a child promise never settles — one hung ticker blocks the whole scan → heartbeat stalls → cron audit RED.

**Fix:** Wrap `computeRelativeVolumeShadow` in a 12s per-ticker `Promise.race` timeout (env `RVOL_SHADOW_TIMEOUT_MS` for tests). Dedupe watchdog problem keys in `cron-audit-query.mjs` log output.

**Verify:** After deploy, `npm run validate:cron` / Cron audit query GREEN during RTH; `zerodte_scan_heartbeat` age <10m; CloudWatch `[cron/zerodte-warm] background done` resumes ~5m cadence.

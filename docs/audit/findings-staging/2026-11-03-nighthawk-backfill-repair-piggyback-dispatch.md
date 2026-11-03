> **kind:** FINDING

## Cron audit query: `nighthawk-backfill-repair` never logged a production run (missing EventBridge rule) — FIXED

| | |
|---|---|
| **Area** | `nighthawk-backfill-repair`, `nighthawk-morning-confirm`, `cron-staleness-watchdog`, `cron-dispatch` |
| **Status** | FIXED — regression tests updated, RED→GREEN via `npx tsx --test` on touched files |
| **Severity** | P1 (cron health / Night Hawk self-heal path silent in prod; CI `Cron audit query` exit 1) |

### Root cause

The dedicated cron route and `railway.nighthawk-backfill-repair.toml` landed on `main` in Oct 2025, but the matching `blackout-infra` `cron-jobs.json` EventBridge entry was never applied (documented in `docs/audit/MARKET-OPEN-VALIDATION.md` §2026-10-25). Production therefore never invoked `/api/cron/nighthawk-backfill-repair`, so `cron_job_runs` had **zero rows** for job key `nighthawk-backfill-repair`. After the 9:00 ET schedule window on a trading day, `buildCronHealthSnapshot()` correctly classified the job as **stale** ("NEVER logged a run"), and `cron-audit-query.mjs`'s HTTP watchdog fallback exited non-zero (`problems: nighthawk-backfill-repair`) on commit `6220d950`.

This is not a transient 520/503 edge case — it is the same deployed-infra-vs-registry gap live-confirmed on 2026-10-26 (`last_run_at=null`, `runs_24h` all zero while `nighthawk-morning-confirm` fired normally).

### Fix

1. Extracted the repair body into `src/features/nighthawk/lib/backfill-repair-pass.ts` (`runNighthawkBackfillRepairPass`).
2. **Piggyback dispatch:** `nighthawk-morning-confirm` (already provisioned on EventBridge) calls the shared pass **before** fetching the edition row, with `callerVerifiedWindow: true`, so every deployed morning run logs `cron_job_runs` for `nighthawk-backfill-repair` and mutates stale BACKFILL contracts before confirmation reads plays.
3. Aligned `cron-registry.ts` comment documenting piggyback; standalone TOML band unchanged (`0 13,14 * * 1-5`).
4. Added `nighthawk-backfill-repair` to `CRON_DISPATCH` + watchdog self-heal targets (idempotent `republishBackfilledEdition`).

Standalone route + TOML remain for manual `?force=1` and the pending infra sync.

### Evidence

- CI run `41649123458` on `6220d950`: `[cron-audit] problems: nighthawk-backfill-repair`, `checked: 50`, exit 1.
- Prior live journal: admin cron-health showed `last_run_at=null` for this key while morning-confirm had fired.

### Verification

- `npx tsx --test src/app/api/cron/nighthawk-backfill-repair/route.test.ts`
- `npx tsx --test src/lib/cron-dispatch.test.ts`
- Post-deploy: `GET /api/admin/cron-health` should show `nighthawk-backfill-repair` with a fresh `last_run_at` on the next weekday morning-confirm fire; `Cron audit query` workflow should return to GREEN.

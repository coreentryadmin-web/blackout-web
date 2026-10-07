> **kind:** FINDING

## Legacy live-sync cron logged nothing on success — real TRIM/CLOSE actions unverifiable from CloudWatch — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Legacy (live monitoring) |
| **Found** | 2026-10-07, live audit, while watching VST cross its own 2x scale-out trigger ($7.00 = 2 × $3.50 entry) in real time |

### Root cause

`src/app/api/cron/legacy-live-sync/route.ts` calls `runLegacyLiveSync` every 5 minutes during RTH
and, on success, only forwards the result to `logCronRun` → `cron_job_runs.meta_json` — a column no
API route exposes. The route itself never logged anything on a successful run (only on the `catch`
branch). So when a real position actually crosses a mechanical trigger — `deriveScaleOutAction`
returning `TAKE_PARTIAL`/`EXIT_RUNNER`/`STOP_OUT` (`src/lib/zerodte/scale-out.ts`) — there was no way
to confirm from CloudWatch (or anywhere reachable from this audit sandbox) that the action actually
fired, as opposed to the position merely being flagged `noQuote` that tick and silently skipped.

This was not a correctness bug in the state machine itself (unit-tested, and the rule is shared with
`banger-live-sync`) — it was a pure observability gap discovered by trying to verify a live event
(VST's mark hit $7.00 at 18:09Z, cleared to $8.15 by 18:37Z) and finding no way to confirm the system
actually acted on it short of a raw Postgres read (blocked from this sandbox) or decoding Discord
channel history.

### Evidence

- EventBridge `blackout-production-legacy-live-sync` confirmed `ENABLED`, `cron(*/5 11-21 ? * MON-FRI *)`.
- `blackout-production-hit-cron` Lambda logs showed `[hit-cron] /api/cron/legacy-live-sync -> 200`
  every 5 minutes through the window VST crossed its trigger — the cron ran, but its own app-level
  logs (`/ecs/blackout-production`, filtered on `"legacy-live-sync"`) had zero matching lines.
- `LEGACY_DISCORD_ALERTS=1` confirmed set in `blackout-production/app/env`, so live management is on.
- No `/api/admin/nighthawk/*` route and no member-facing route reads `discord_live_state` /
  `trims_taken` — confirmed by grep across `src/app/api`.

### Fix

Added a single `console.info` in the route, gated on `result.transitions.length > 0` (so an ordinary
HOLD-only tick — the overwhelming majority — logs nothing, same noise floor as before), placed after
`runLegacyLiveSync` resolves and before the `logCronRun` handshake. Logs the transitions array
verbatim (ticker + action), not just a count, so a CloudWatch filter on `"legacy-live-sync"` now
shows exactly which position scaled/closed and how.

Regression test (`route.test.ts`) asserts: the log line exists, is gated on a non-empty transitions
array, and runs after `runLegacyLiveSync(` but before the `logCronRun(CRON_KEY, started, ...)`
handshake (so it can't be dropped by an early return). RED confirmed by stashing the route change and
re-running the test (assertion failure, "must gate a log line on non-empty transitions"); GREEN after
restoring it.

### Blast radius

Single file (`route.ts`) + its test. No other caller of `runLegacyLiveSync` needs this — the sibling
`banger-live-sync` route has the identical gap but was explicitly left untouched here per the
issue-handling policy's "one issue per branch/PR" discipline; worth a follow-up finding if this
pattern recurs 3 times (noise-discipline threshold already established for this lane).

### What was deliberately left unchanged

Did not add a member-facing API to expose `discord_live_state`/`trims_taken` — that's a real product
enhancement (logged in the live journal, `docs/audit/nighthawk-legacy-live-journal.json`,
2026-10-07T18:13Z entry) but is a larger, UI-surfacing decision outside this fix's scope (pure
observability, zero behavior change, additive-only).

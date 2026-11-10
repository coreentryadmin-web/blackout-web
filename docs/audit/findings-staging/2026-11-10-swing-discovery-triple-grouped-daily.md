> **kind:** `FINDING`

## `swing-discovery` tripled grouped-daily REST pulls per phase — amplifying Polygon 429 failures

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/app/api/cron/swing-discovery/route.ts` |
| **Severity** | P1 — cron audit `query` on `main@1f445e92` (run 42735522106, 2026-11-10 01:25 UTC) reported `problems: swing-discovery` only; live window still showed POST_CLOSE snapshot not refreshed after #7832 bounded the minute-bar / last-trade fan-outs |

### Root cause

`buildDiscoveryDeps()` called `fetchDailyMarketSummary(to)` separately in `fetchGroupedDaily`, `fetchBangerTickers`, and (when enabled) the intraday-structure preamble — three full-market grouped-daily GETs per successful scan. After #7832 fixed the 40-wide fan-outs, admin health still showed grouped-daily 429 as `last_message`, with a stale serving snapshot and cron audit paging.

### Fix

`createMemoizedGroupedDailyLoader()` (`src/lib/swing/discovery-grouped-daily-load.ts`) shares one in-flight grouped-daily fetch per scan and retries transient 429 / circuit-open errors with short backoff before failing the phase.

### Evidence

Unit tests: `discovery-grouped-daily-load.test.ts` (memo + retry). `route.test.ts` source assertion that the route wires the memoized loader.

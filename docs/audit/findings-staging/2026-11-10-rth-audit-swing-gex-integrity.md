> **kind:** FINDING

## RTH deep audit — swing-discovery + GEX positioning false RED — FIXED

| **Status** | FIXED on branch `cursor/autopilot-work-loop-6370` |
| --- | --- |

**Symptom (main `0ba380023`, workflow RTH deep audit run `42897223779`, ~15:38 ET):**
- `cron-watchdog` / full-site P1: `swing-discovery` handshake stale while an active scan phase (POWER_HOUR) had not completed yet.
- P0 `data-integrity` / cross-tool: `getGexPositioning("SPX"|"SPY")` returned no matrix despite heatmap matrix probe green for preset tickers.

**Root cause:**
1. `swingDiscoveryAwaitingPhaseSuppress` only honored phase-awaiting after POST_CLOSE was satisfied; during POWER_HOUR and the 16:00–16:15 inter-phase gap on a trading day, stale cron handshake was still surfaced as `failed`/`stale`.
2. `evaluateCronWatchdogAudit` treated all `nonRthProblems` as hard fails during RTH; phase-anchored jobs like `swing-discovery` need the same suppress semantics as the server cron health snapshot.
3. C6 integrity used `getGexPositioning` only; that reader can be briefly null while `fetchGexHeatmap` still serves a live matrix (cache path used by heatmap audit).

**Fix (layered on #7898 main):**
- Inter-phase idle gap (16:00–16:15 ET) suppress in `swingDiscoveryAwaitingPhaseSuppress` (#7898 already fixed POWER_HOUR + GEX prewarm/retry/circuit skip).
- C6: `fetchGexHeatmap` backstop when `getGexPositioning` stays null after retries.

**Verify:** `npx tsx --test src/lib/swing/discovery-cron-health.test.ts scripts/audit/lib/watchdog-audit-eval.test.ts`; next scheduled RTH deep audit during open session.

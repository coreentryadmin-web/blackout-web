> **kind:** FINDING

## cron-audit query false P0: post-close crons flagged Monday morning before UTC band

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Detected** | Cron audit query run 42649315653 on `main` @ `1cc122c0` (2026-11-09 ~10:55 ET) |
| **Symptom** | `problems: nighthawk-outcomes, gex-eod-snapshot, banger-discovery` (+ `spx-evaluate` if engine stale) |
| **Root cause** | `evaluateJob` surfaced Friday `failed` / age-stale handshakes during trading-day schedule idle gap (only suppressed Sat/Sun via `nonTradingScheduledIdle`) |
| **Fix** | `scheduleIdleGap` suppresses any last-run status while between EventBridge bands (ops #1983) |
| **Verify** | `admin-cron-health.test.ts` Monday pre-window case; next scheduled cron-audit-query |

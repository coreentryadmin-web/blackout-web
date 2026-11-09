## 2026-11-09 — Cron query failed Monday on post-close Friday failed handshakes — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `Cron audit query` on `main` @ `1cc122c` reported `problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`. |
| **Root cause** | `evaluateJob` suppressed `ok`/`skipped` post-close handshakes during `isInOffScheduleIdleGap`, but treated a Friday `failed` as still `failed` on Monday morning — failing cron-audit-query before the first ~4pm ET UTC band. |
| **Fix** | Include `failed` in schedule-idle-gap suppression when `schedule_cron_utc` is set (ops #1983 extension). |
| **Status** | Fixed — `admin-cron-health.ts` + regression test at 2026-11-09T15:55Z. |
| **Note** | `spx-evaluate` may still alert if the engine handshake is genuinely stale during RTH — that signal is unchanged. |

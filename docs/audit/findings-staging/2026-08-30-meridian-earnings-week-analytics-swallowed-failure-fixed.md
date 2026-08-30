## 2026-08-30 — [FINDING, P3 Meridian] `earnings_week_analytics` historical fetch silently swallowed on failure — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Severity** | P3 |
| **Root cause** | `loadBenzingaEarningsBundle` `.catch(() => ({ rows: [] }))` on the mega-cap week historical-print fetch dropped upstream failures with no error flag — beat-rate rollups looked like honest empty history. |
| **Fix** | Capture `hist.error` into `earnings_week_analytics_error` on the Benzinga bundle, thread through `meridian-timeline-server` → `meridian-snapshot` → `MeridianTimelinePayload`, and render a `meridian-feed-error` banner on the desk when set (mirrors `calendar_error` on earnings tabs). |
| **Evidence** | Unit/type compile + existing Meridian analytics tests green; live validation deferred to Monday RTH (week grid populated off-hours). |
| **Status** | FIXED |

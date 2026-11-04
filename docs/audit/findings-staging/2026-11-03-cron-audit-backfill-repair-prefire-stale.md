> **kind:** FINDING

## Cron audit query P0 on nighthawk-backfill-repair — FIXED (complements #7420)

| **Status** | FIXED |

**Symptom:** `Cron audit query` failed at **2026-11-03 13:58 UTC** with `problems: nighthawk-backfill-repair`.

**Root cause:** The **13:00 UTC** EventBridge band runs before the 9:00 ET repair window and logged **`ok: false, skipped: true`**, so the latest run read as a failure and `#7420`'s dual-band suppress did not apply. Weekend age also exceeded the **36h** stale ceiling before the **14:00 UTC** in-window band.

**Fix:** Off-window skip logs **`ok: true, skipped: true`**; **`stale_after_min`** raised to **72h** for this once-daily weekday job. Dual-band idle gap handled on main via `#7420` (`isAwaitingSecondaryUtcBandFire`).

**Verify:** After merge, Monday query before 14:00 UTC should stay green when the early band skips intentionally.

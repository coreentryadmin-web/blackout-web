> **kind:** `FINDING`

## 2026-11-09 — `query` CI: post-close crons + spx-evaluate on Monday open — FIXED (post-close part)

| **Status** | Fixed (PR pending) |
|------------|-------------------|
| **Symptom** | `Cron audit query` on `main@1cc122c` (run **42649315653**, 10:55 ET): `problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`. |
| **Root cause (post-close trio)** | `evaluateJob` suppressed stale off-schedule handshakes for `ok`/`skipped` only — a **Friday `failed`** last run still tripped `failed` on Monday inside `isInOffScheduleIdleGap`, contradicting ops #1983 (weekend / pre-fire silence). |
| **Root cause (spx-evaluate)** | Live snapshot at failure time: last `ok` handshake ~85m old with engine window active — likely transient deploy/cron gap; watchdog empty on re-probe minutes later. No code change this pass beyond existing HB override. |
| **Fix** | Treat `failed` like `ok`/`skipped` when `scheduleIdle` (off-schedule idle gap or awaiting dual UTC band). |
| **Verify** | `npx tsx --test src/lib/admin-cron-health.test.ts`; next `query` should not list post-close trio before evening fire. |

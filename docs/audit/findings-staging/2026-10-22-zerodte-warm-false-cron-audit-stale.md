> **kind:** FINDING

## zerodte-warm false `critical_stale` tripped cron-audit-query during long in-flight scans — FIXED

| **Status** | FIXED (branch) |
| --- | --- |
| **Symptom** | `cron-audit-query` RED on `main` (`problems: zerodte-warm`) during RTH while 0DTE discovery was still running. |
| **Root cause** | `recordZeroDteScanTick` fired only after `scanZeroDteBoard()` returned; prod runs measured 10–11+ minutes while overlap lock held. Default `critical_stale` at 10m flagged the job stale before the tick advanced. |
| **Fix** | Start-of-`warmZeroDteBoard` liveness tick + zerodte-specific `criticalStaleMs: 18m` (aligned with registry `stale_after_min: 15`). |
| **Verify** | `npx tsx --test src/lib/play-engine-heartbeat.test.ts src/lib/zerodte/scan.test.ts` (new ratchets); next RTH `Cron audit query` workflow should stay green unless scan truly stalls >18m without starting. |

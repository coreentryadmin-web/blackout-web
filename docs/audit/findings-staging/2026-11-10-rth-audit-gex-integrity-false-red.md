> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | RTH deep audit RED on transient GEX cold + swing-discovery P1 (run 42897223779) |
| **Status** | FIXED |

## Root cause

During live RTH (Tue ~3:38 PM ET), `runDataIntegrityChecks` C6 opened issues when `getGexPositioning` returned null even though `fetchGexHeatmap` had a warm matrix (heatmap audit passed in the same run). `evaluateCronWatchdogAudit` also failed on non-`rth_stale` `swing-discovery`, contradicting its own header (market-hours stale only).

## Fix

- C6: confirm matrix cold via `fetchGexHeatmap` before emitting “cold during RTH”.
- `shouldFail` only on `rth_stale_keys` or critical error spike.

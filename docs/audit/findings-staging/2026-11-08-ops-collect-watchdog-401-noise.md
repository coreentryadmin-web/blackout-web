> **kind:** FINDING

## ops-collect spawned agents on watchdog 401 (collector CRON drift)

| **Status** | FIXED (this PR) |
|------------|-----------------|
| **Symptom** | `ops:collect` item `watchdog:http` P2, fingerprint `65a19bff24d2` every cloud-agent tick |
| **Root cause** | Probe 401 = local `CRON_SECRET` ≠ prod; not a cron outage — still counted as dispatchable action item |
| **Fix** | `shouldEmitWatchdogHttpActionItem()` — skip auth failures; log stderr hint to reconcile secrets |

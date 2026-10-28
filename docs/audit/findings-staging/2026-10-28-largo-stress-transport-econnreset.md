# Largo stress nightly crash on fetch ECONNRESET after 429 burst

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|
| **When** | Largo stress nightly run 40695702887 (2026-10-28) |
| **Symptom** | Job exited 1: `TypeError: fetch failed` / `read ECONNRESET` mid-bank after several Cloudflare `http-429` SKIPs |
| **Root cause** | `askLive` used `fetchRetry` with only 1 retry; when retries exhausted, the error propagated and killed the worker. 429 was retried at a higher layer but transport errors were not. |
| **Fix** | Catch exhausted fetch errors → `transport_error`; retry transport in `askLiveThrottleAware`; score via `liveTransportVerdict` (SKIP, excluded from quality). |
| **Verify** | Next scheduled Largo stress nightly GREEN; `node --import tsx --test scripts/largo-stress-scoring.test.mjs`. |

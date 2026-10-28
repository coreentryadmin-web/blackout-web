> **kind:** FINDING

## Largo stress nightly aborted on transient fetch ECONNRESET

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** `largo-stress-nightly.yml` red on `main` @ `734b7f94` — bank1 sweep crashed with `TypeError: fetch failed` / `read ECONNRESET` (~18m in), no report artifact.

**Root cause:** `askLive` used `fetchRetry` with `retries: 1`; an uncaught throw in the worker aborted the whole run instead of SKIP transport handling used for HTTP 429/401.

**Fix:** Default 4 fetch retries; catch exhausted transport errors per question as SKIP and continue the bank.

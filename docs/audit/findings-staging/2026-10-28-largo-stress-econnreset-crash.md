> **kind:** FINDING

## Largo stress nightly crash on ECONNRESET after 429 burst — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Observed (2026-10-28, workflow `Largo stress nightly`, run 40695702887, commit `734b7f94`):**

After ~100/109 bank1 live probes, a Cloudflare **429** burst was correctly recorded as transport **SKIP**s. The next request threw **`TypeError: fetch failed` / `read ECONNRESET`** from `fetchRetry` in `askLive` — uncaught, exit 1. Not a Largo answer-quality BAD.

**Fix:** Catch fetch failures in `askLive`, return `{ status: 0, transport_error }` scored as SKIP; raise `fetchRetry` retries/backoff for the live probe path.

**Verify:** Next `largo-stress-nightly` completes (may warn on transport skips; must not crash mid-bank).

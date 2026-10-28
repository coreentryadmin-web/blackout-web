## 2026-10-28 — [FINDING, P2 CI / Largo] `largo-stress-nightly` uncaught `fetch failed` / ECONNRESET crashed the whole sweep — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR pending) |
| **Found by** | CI subscription on `main`, run `40695702887` @ `734b7f94`, 2026-10-28 |
| **Scope** | `scripts/largo-stress-run.mjs` |

### Root cause

After a long live bank sweep (many prior `http-429` SKIPs), `fetchRetry` in `askLive` exhausted its
**single** retry and threw `TypeError: fetch failed` with `read ECONNRESET`. That exception was
uncaught inside the concurrent `worker()` loop, so Node terminated the job before writing a complete
report — CI read it as a hard failure, not as transport noise excluded from `live_quality_pct`.

429 handling already mapped non-200 answers to `SKIP`; transient TCP resets did not.

### Fix

- Wrap `fetchRetry` in `askLive` try/catch; return `{ status: 0, transport_error }` on failure.
- Raise `fetchRetry` retries from 1 → 4 for the Largo POST path.
- Extend `askLiveThrottleAware` to backoff-retry on `transport_error` as well as 429.
- Score transport failures as `SKIP` with an explicit `ECONNRESET — transport…` issue string.

### Regression guard

`src/largo-stress-router.test.ts` — source-read assertions on the transport catch, throttle retry,
SKIP labeling, and retry count.

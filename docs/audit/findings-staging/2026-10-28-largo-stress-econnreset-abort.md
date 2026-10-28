> **kind:** FINDING

## 2026-10-28 — largo-stress nightly aborts on Cloudflare 429 tail ECONNRESET — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |
| **Severity** | P2 CI / ops noise |
| **Symptom** | Scheduled `largo-stress-nightly.yml` run [40695702887](https://github.com/coreentryadmin-web/blackout-web/actions/runs/40695702887) on `734b7f94b` exited 1 mid-sweep: several `http-429` SKIPs, then uncaught `TypeError: fetch failed` / `ECONNRESET` from `askLive` — process died before writing the full report. |
| **Root cause** | `askLiveThrottleAware` only retried HTTP 429 responses; when `fetchRetry` exhausted retries on a transient reset, the exception propagated out of the worker loop and killed the job. Not a Largo answer-quality regression. |
| **Fix** | Extract `withLiveTransportRetries` (`scripts/largo-stress-live-transport.mjs`) to retry both 429 and retryable fetch errors, then return a transport SKIP (`status: 503`, `transport_failed`) instead of throwing. Bump per-request `fetchRetry` retries 1→3 in `askLive`. |
| **Verify** | `npx tsx --test scripts/largo-stress-live-transport.test.ts` |

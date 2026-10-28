> **kind:** FINDING

## Largo stress nightly — uncaught ECONNRESET after 429 burst aborts whole run — FIXED

| **Status** | FIXED (PR pending, fix/largo-stress-transport-fetch-crash) |
| **Severity** | P2 (CI signal / harness reliability — not a Largo product regression) |
| **Area** | Audit harness / Largo stress nightly |

**What broke:** Scheduled workflow `Largo stress nightly` (run 40695702887 on `734b7f94`) answered ~90+ prompts successfully, then recorded several `http-429` SKIPs from Cloudflare. The next `fetchRetry` threw `TypeError: fetch failed` with cause `ECONNRESET`, which was uncaught in `askLive()` — the Node process exited 1 before finishing the bank.

**Root cause:** Transport failures after retry exhaustion were not converted to the existing SKIP path (unlike HTTP 429/401 handling). `fetchRetry` used only `retries: 1` on a long high-concurrency sweep.

**Fix:** Wrap `askLive()` in try/catch returning `status: 0` + `transportError`; score as transport SKIP; bump fetch retries to 3. Regression test: `src/largo-stress-fetch-transport.test.ts`.

**Verify:** Re-run `Largo stress nightly` or `LARGO_STRESS_LIVE=1 node --import tsx scripts/largo-stress-run.mjs` — a mid-run edge reset must SKIP one question, not crash the job.

## 2026-10-28 — [FINDING, P2 CI / Largo] `largo-stress-nightly` hard-fails on transient `ECONNRESET` after 429 burst — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | Run `40695702887` on `734b7f94`: ~100+ live OK, several 429 SKIPs, then uncaught `TypeError: fetch failed` / `read ECONNRESET` in `fetchRetry` → worker pool abort → exit 1 (not a BAD Largo answer). |
| **Root cause** | `askLive` used `fetchRetry` with `retries: 1`; after retries exhausted, the error propagated out of the worker. Design already treats non-200 as transport SKIP, but transport-layer throws bypassed that path. |
| **Fix** | `scripts/largo-stress-run.mjs`: catch `fetchRetry` failures → `{ status: 0, transport_error }`; retry transport in `askLiveThrottleAware`; worker try/catch backstop; default `LARGO_STRESS_FETCH_RETRIES=3`. |
| **Regression** | `scripts/audit/lib/fetch-retry.test.mjs`; `src/largo-stress-router.test.ts` source ratchet on `transport_error`. |
| **Status** | FIXED — branch `fix/largo-stress-transport-skip`. |

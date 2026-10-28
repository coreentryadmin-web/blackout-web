> **kind:** FINDING

## 2026-10-28 — Largo stress nightly crashed on ECONNRESET after fetch retries — FIXED

| **Status** | FIXED on `fix/largo-stress-transport-econnreset` |
| --- | --- |

**Symptom:** `largo-stress` CI on `main` @ `734b7f94` (run 40695702887) exited with unhandled `TypeError: fetch failed` / `read ECONNRESET` in `askLive` → `fetchRetry`.

**Root cause:** `askLive` used `retries: 1` and did not catch transport errors after retry exhaustion. HTTP 429 was handled as SKIP; thrown fetch errors were not.

**Fix:** Catch transport failures in `askLive`, return `status: 0` + `transport_error`; `liveTransportVerdict` / `liveResponseShouldRetry` in `largo-stress-scoring.mjs`; throttle-aware retries on transport; default four fetch attempts via `LARGO_STRESS_FETCH_RETRIES=3`.

**Verify:** Re-run `Largo stress nightly` workflow; sweep should complete with SKIP rows for transient transport, not crash.

> **kind:** FINDING

## Largo stress nightly — uncaught fetch transport crash (2026-10-28)

| **Status** | FIXED |
| --- | --- |
| **Symptom** | GHA `largo-stress` job exit 1 on `main` @734b7f94 — not `live_bad > 0`; worker threw on `fetch failed` / `read ECONNRESET` after many Cloudflare 429 SKIPs. |
| **Root cause** | `askLive()` awaited `fetchRetry` without try/catch; exhausted retries rethrow and abort the whole sweep. |
| **Fix** | Catch transport failures → `{ status: 0, transport_error }`; score via `scoreLiveHttpOutcome()` as SKIP (same tally philosophy as http-429). Raised live POST `fetchRetry` retries 1→3. |
| **Verify** | `npx tsx --test src/largo-stress-router.test.ts`; next nightly `largo-stress` should complete with transport SKIPs warned, exit 0 unless real BAD answers. |

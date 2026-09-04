## 2026-09-04 — [FINDING, P1] Deploy smoke failed on transient Clerk FAPI reset in SEO audit

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Surface** | `scripts/audit/seo-visibility-audit.mjs` (deploy-smoke `validate:seo` step) |
| **Symptom** | `main@6776238a` deploy-smoke **smoke** job failed: `curl: (35) Recv failure: Connection reset by peer` → `auth — session JWT missing` despite 19/20 public SEO checks PASS |
| **Root cause** | Clerk FAPI token mint had no retry on transient TLS reset; script labeled auth failure AMBER but still exited 1, failing deploy-smoke |
| **Fix** | `curlRetry` on FAPI sign-in + token mint; shared `isRetryableCurlResult` / `seoAuditExitCode` helpers; auth-only failures exit 0 |
| **Evidence** | GHA run 33909058922; `scripts/audit/seo-visibility-audit.test.mjs` |

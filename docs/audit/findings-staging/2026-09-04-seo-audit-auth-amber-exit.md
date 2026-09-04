# 2026-09-04 — [FINDING, P1 deploy-smoke] SEO audit auth flake failed deploy smoke despite AMBER verdict — FIXED

> **kind:** FINDING

| Field | Detail |
|---|---|
| **What prompted this** | Deploy smoke on `6776238` failed: `validate:seo` reported `AMBER — 19 checks, 1 fail` (`auth: session JWT missing`) due to `curl: (35) Connection reset by peer` during Clerk FAPI token mint — but still exited 1. |
| **Root cause** | `seo-visibility-audit.mjs` labeled auth-only failures AMBER (harness/Clerk infra) yet `process.exit(fails.length ? 1 : 0)` treated AMBER same as RED product SEO failures. No retry on transient Clerk connection reset. |
| **Fix** | Retry session JWT mint up to 3× with backoff; `seoAuditExitCode()` exits 0 when failures are auth-only (AMBER), 1 only for real SEO RED. |
| **Evidence** | `scripts/audit/seo-visibility-audit.test.mjs` — 3 pass |
| **Status** | FIXED |

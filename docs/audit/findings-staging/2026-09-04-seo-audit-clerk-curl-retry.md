# SEO audit Clerk FAPI curl retry — 2026-09-04

> **kind:** FINDING

## Deploy smoke `auth` flake on Clerk FAPI TLS reset

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 — CI noise / false deploy-smoke RED |
| **Surface** | `scripts/audit/seo-visibility-audit.mjs` → `deploy-smoke.yml` `validate:seo` |

### Symptom

`main@6776238a9` deploy smoke failed:

```
curl: (35) Recv failure: Connection reset by peer
[FAIL] auth — session JWT missing
=== AMBER — 19 checks, 1 fail ===
```

### Root cause

`mintSession()` uses synchronous `curl` via `execFileSync` against Clerk FAPI (`sign_ins` + `tokens`).
A transient TLS reset during ticket exchange returns `{ s: 0, err }` with no retry — JWT mint fails
even though Clerk is healthy.

### Fix

- New `scripts/audit/lib/curl-retry.mjs`: `isRetryableCurlResult` + `curlWithRetry` (reuses
  `fetch-retry.mjs` retryable codes; 4 attempts, 1.5s backoff).
- `seo-visibility-audit.mjs` wraps all curl calls through retry layer.

### Evidence

- `npx tsx --test scripts/audit/lib/curl-retry.test.mjs` — 5/5 pass
- `npm run validate:seo` — GREEN post-fix

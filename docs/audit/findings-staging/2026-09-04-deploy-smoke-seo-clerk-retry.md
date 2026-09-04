# Deploy smoke SEO audit Clerk FAPI transient retry — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 (deploy-smoke false failure) |
| **Area** | `scripts/audit/seo-visibility-audit.mjs` |

## Symptom

Deploy smoke on `main` @ `6776238a` failed at SEO visibility audit: `auth — session JWT missing` after `curl: (35) Recv failure: Connection reset by peer` during Clerk FAPI token exchange. HTTP smoke and ECS health poll were GREEN.

## Root cause

Single-shot curl to `clerk.blackouttrades.com` FAPI with no retry. Transient TLS resets during ECS rollouts or GHA egress are common and not product defects.

## Fix

Extract `withTransientRetry` / `isTransientCurlFailure` to `scripts/audit/lib/curl-transient-retry.mjs` and wrap Clerk `sign_ins` + session `tokens` calls in seo-visibility-audit.mjs (3 attempts, backoff).

## Evidence

- Failed run: GitHub Actions `33909058922` (deploy-smoke)
- Unit tests: `scripts/audit/lib/curl-transient-retry.test.mjs`

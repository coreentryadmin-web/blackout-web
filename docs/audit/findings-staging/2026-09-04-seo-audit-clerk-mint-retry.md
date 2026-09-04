# 2026-09-04 — deploy-smoke SEO audit fails on transient Clerk FAPI flake

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `scripts/audit/seo-visibility-audit.mjs`, `scripts/audit/lib/seo-visibility-verdict.mjs` |

## Symptom

`deploy-smoke.yml` job `smoke` failed on `main` (`6776238a`) at `npm run validate:seo`:
`curl: (35) Recv failure: Connection reset by peer` during Clerk FAPI token mint → `auth: session JWT missing`.
All public SEO checks (robots, sitemap, canonical, GA4, llms.txt) passed.

## Root cause

`seo-visibility-audit.mjs` treated any FAIL (including best-effort authed desk checks) as exit 1.
Deploy-smoke gates on public SEO visibility; a one-shot Clerk curl reset is not a product defect.

## Fix

1. Extracted verdict/exit policy to `seo-visibility-verdict.mjs` — auth-only FAIL → AMBER, exit 0.
2. Split `mintSessionOnce()` + `mintSession(maxAttempts=3)` with retry on transient curl errors
   (`connection reset`, `ECONNRESET`, `ETIMEDOUT`, `s=0`).
3. Deploy-smoke still fails RED when public SEO checks break.

## Tests

`scripts/audit/lib/seo-visibility-verdict.test.mjs` — 5 cases (GREEN/AMBER/RED exit policy + transient curl).

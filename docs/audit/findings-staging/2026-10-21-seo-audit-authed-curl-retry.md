# 2026-10-21 — SEO audit authed fetch missing curlRetry

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

Deploy smoke RED on `main@aaf1cf0f` — `validate:seo` failed `admin /dashboard: HTTP 0` (`curl: (56) Recv failure: Connection reset by peer`) while the immediately following authed `/dashboard` content check passed.

## Root cause

`fetchPublic()` already uses `curlRetry` + `isRetryableCurlResult`; `fetchAuthed()` still called bare `curl()`, so a mid-rollout edge reset failed the gate on the first probe only.

## Fix

Route `fetchAuthed()` through `curlRetry` (same backoff as public paths).

## Verify

Re-run deploy smoke / `npm run validate:seo` after merge — authed dashboard probe should survive a single transient reset.

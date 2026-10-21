# Deploy smoke SEO audit — authed /dashboard curl reset false RED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@aaf1cf0f` deploy **smoke** failed: SEO visibility audit `[FAIL] admin /dashboard — HTTP 0` (`Recv failure: Connection reset by peer`). `/api/health` and the second authed desk-shell check passed in the same run.

## Root cause

`fetchPublic` already uses `curlRetry` for transient TLS/edge resets; `fetchAuthed` called bare `curl()` once — same failure mode documented for public paths in 2026-09-13/14.

## Fix

Wire `fetchAuthed` through `curlRetry`.

## Verify

`node --import tsx --test scripts/audit/seo-visibility-audit.test.mjs`; next deploy smoke on main.

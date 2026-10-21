> **kind:** FINDING

## Deploy smoke RED — SEO audit admin /dashboard HTTP 0 (connection reset)

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**What broke:** `Deploy smoke` → `npm run validate:seo` failed on `admin /dashboard: HTTP 0` with `curl: (56) Recv failure: Connection reset by peer` (`main` @ `aaf1cf0`, 2026-10-21 ~19:03 UTC).

**Root cause:** `fetchAuthed()` in `seo-visibility-audit.mjs` used bare `curl()` while `fetchPublic()` already used `curlRetry()` + `isRetryableCurlResult` for the same deploy-rollout blip.

**Fix:** Route authed fetches through `curlRetry()`. Regression test locks `fetchAuthed` to the retry harness.

**Live check:** Re-run `Deploy smoke` on `main` after merge; SEO step should pass unless prod is genuinely down.

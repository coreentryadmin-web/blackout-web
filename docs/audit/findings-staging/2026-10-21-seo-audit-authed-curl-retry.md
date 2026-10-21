> **kind:** FINDING

## Deploy smoke RED on transient admin /dashboard connection reset — FIXED

| **Status** | FIXED |
|------------|-------|

**Symptom:** `smoke` failed on `aaf1cf0f` after public SEO checks passed; `admin /dashboard` reported HTTP 0 (`Recv failure: Connection reset by peer`) during ECS rollout.

**Root cause:** `fetchAuthed()` used bare `curl()` while `fetchPublic()` already used `curlRetry()` + `isRetryableCurlResult`.

**Fix:** Route authed desk probes through `curlRetry`.

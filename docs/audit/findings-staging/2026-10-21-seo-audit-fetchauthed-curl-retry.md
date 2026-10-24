# SEO deploy-smoke flake — fetchAuthed lacked curlRetry — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

Deploy smoke on `aaf1cf0f` failed `validate:seo`: `admin /dashboard: HTTP 0` with `curl: (56) Recv failure: Connection reset by peer` during ECS rollout. Prod recovered immediately (transient).

## Root cause

`fetchPublic` already used `curlRetry`; `fetchAuthed` still called bare `curl()`, so authed dashboard probe could not retry the same transient edge reset.

## Fix

Wire `fetchAuthed` through `curlRetry` + regression test.

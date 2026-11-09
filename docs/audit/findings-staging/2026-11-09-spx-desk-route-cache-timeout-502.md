> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Title** | deploy-smoke: /api/market/spx/desk 502 on ServerCacheTimeoutError |
| **Status** | FIXED |

## Root cause

`loadSpxDesk()` throws `ServerCacheTimeoutError` when a cold build exceeds `deskBootstrapMaxBlockMs()`. The desk route's catch block mapped **all** errors to HTTP 502, while the sibling `/api/market/spx/play` route already degrades on that specific error. GHA deploy-smoke run 42550161810 (`main@0dee31c5`) failed with `unexpected HTTP 502` on the cron-authed desk probe even though health/ready and other gated routes were fine.

## Fix

Handle `ServerCacheTimeoutError` in `src/app/api/market/spx/desk/route.ts`: peek stale desk, else pulse-shell fallback — HTTP 200 honest JSON (same contract as play route).

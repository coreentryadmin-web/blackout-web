# RTH deep audit crash on full-site fetch ECONNRESET

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — `RTH deep audit` / `audit` check noise |
| **Discovered** | 2026-10-22 run 39839665457 (post-#6592) |

## Symptom

`gha-rth-audit` reported `FAILED (1): Full-site deep audit` because `full-site-deep-audit.mjs` threw uncaught `TypeError: fetch failed` / `read ECONNRESET` in `getJson` during `auditCrons()`. Postgres and socket-health sections already passed/skipped.

## Root cause

`getJson` had no retry; a single transient GHA→origin reset aborted the entire script (non-zero exit) even though only P1/P2 issues are meant to fail the numeric audit.

## Fix

Retry transient fetch errors in `getJson`; on exhaustion record a P2 network issue and return `{ status: 0 }` instead of throwing.

## Verify

Re-run `RTH deep audit` on GHA; isolated ECONNRESET during cron plane fetch should not crash the harness.

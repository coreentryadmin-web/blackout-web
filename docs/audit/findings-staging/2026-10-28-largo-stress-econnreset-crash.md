# Largo stress nightly crashed on fetch ECONNRESET after 429 storm

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — CI / monitoring |
| **Discovered** | Largo stress nightly run 40695702887 on `main@734b7f94` |

## Symptom

After many Cloudflare `http-429` SKIPs, the harness threw uncaught `TypeError: fetch failed` / `read ECONNRESET` in `askLive` and aborted the bank mid-sweep.

## Root cause

`askLiveThrottleAware` only retried HTTP 429 responses; exhausted `fetchRetry` network errors propagated and killed the worker pool.

## Fix

Retry transient fetch errors in `askLiveThrottleAware`; map exhausted failures to transport SKIP (`status: 0` / `transportError`); raise `fetchRetry` attempts from 1→3 per live question.

## Evidence

Run 40695702887 — ~19 minutes of OK answers, then 429 SKIPs, then crash at `fetchRetry` / `askLive`.

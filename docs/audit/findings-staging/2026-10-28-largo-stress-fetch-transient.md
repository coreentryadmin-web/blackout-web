# 2026-10-28 — largo-stress nightly crash on ECONNRESET after CF 429 burst

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

`Largo stress nightly` failed (run 40695702887) with uncaught `TypeError: fetch failed` / `ECONNRESET` mid-bank after several Cloudflare `http-429` SKIPs.

## Root cause

`askLive` used `fetchRetry` with only one retry and no catch — exhausted transport errors escaped the worker and aborted the whole sweep.

## Fix

Catch exhausted fetch errors → `{ status: 0, fetch_failed }` scored as SKIP; raise default fetch retries to 4.

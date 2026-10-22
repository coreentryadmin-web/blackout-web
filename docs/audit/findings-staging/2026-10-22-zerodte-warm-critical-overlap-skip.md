# zerodte-warm overlap lock skip while scan heartbeat critical_stale — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`Cron audit query` failed on `main` 2026-10-22 15:51 UTC (`problems: zerodte-warm`) despite #6494/#6507/#6546.

## Root cause

When `zerodte_scan_heartbeat` was already `critical_stale`, fires could still idempotent-skip on `previous zerodte warm still in flight` if `OVERLAP_LOCK_KEY` remained set from a hung or very slow background warm. Heavy-cron escalation (#6546) did not cover this path.

## Fix

On `critical_stale`, clear overlap lock and retry `sharedCacheSetNx` once before returning the idempotent skip.

## Evidence

GH Actions `39808664306`.

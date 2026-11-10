# Cron query RED — swing-discovery trailing failed handshake — FIXED

> **kind:** `FINDING`

## Symptom

`cron-audit-query` on `main@1f445e92` at 2026-11-10 ~01:25 UTC: `problems: swing-discovery` only.

## Root cause

`evaluateJob` treated the latest `cron_job_runs` row as authoritative. EventBridge retriggers swing-discovery many times per phase; a successful POST_CLOSE `ok` can be followed by a trailing `failed` (lock race / ALB timeout) within the same 24h. Watchdog surfaced `failed` even though a fresh `ok` still sat inside the handshake ceiling.

## Fix

For `swing-discovery` only: when last status is `failed` but any `ok` in `runs_24h` is within `effectiveStaleMinutes`, downgrade to `warning` (excluded from `problem_keys`).

## Status

| **Status** | FIXED (PR branch `cursor/autopilot-work-loop-aeaa`) |

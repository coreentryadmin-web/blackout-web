# 2026-10-22 — GHA RTH deep audit RED on transient socket-health + Postgres

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

`RTH deep audit` failed on `main@7b0f46b0` (run 39836457065): `socket-health: HTTP 503` and `postgres: read ECONNRESET` while full-site HTTP audit was largely GREEN.

## Root cause

`gha-rth-audit.mjs` used a single `fetch` for socket-health (no retry on 503/warming) and treated `ECONNRESET` as a hard Postgres failure — unlike `rth-open-check.mjs` after #6584.

## Fix

Reuse `probeOptionsSocketWithRetries` for socket-health and the same transient Postgres retry/skip path as RTH open-check.

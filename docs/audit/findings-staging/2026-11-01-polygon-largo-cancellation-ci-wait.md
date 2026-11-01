# 2026-11-01 — verify RED on polygon-largo cancellation test under CI load

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

CI verify failed on `main@7f5519c17`: `fetchPolygonTickerDetails: aborting the caller's signal...` — connection wait timed out at 2s.

## Root cause

Flaky harness timing: after ~5m of prior tests on GHA, polygon rate-limiter admission for the second shared-module test can exceed 2s; not a regression in #7277.

## Fix

Use 10s connect wait on `GITHUB_ACTIONS` (override via `POLYGON_ABORT_TEST_CONNECT_MS`).

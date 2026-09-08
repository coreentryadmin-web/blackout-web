# 2026-09-04 — site-latency OFF_HOURS browser ReferenceError

> **kind:** FINDING

## Symptom

Sentry production error: `ReferenceError: OFF_HOURS is not defined` (2026-09-04 ~05:30 UTC).

## Root cause

`scripts/site-latency-audit.mjs` dashboard `page.ready` closed over Node-only `OFF_HOURS` inside a function passed to `page.waitForFunction()`. Playwright serializes the function into the browser without Node closures, so every scheduled site-latency run threw in production members' sessions when the audit harness ran.

## Fix

Pass `readyMinRows` as the `waitForFunction` argument; dashboard `ready(minRows)` uses only browser globals.

## Status

FIXED in PR (regression test: `scripts/site-latency-audit.test.ts`).

# Site latency audit OFF_HOURS ReferenceError in browser context — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P1-0105 |
| **Priority** | P1 |
| **Status** | FIXED |
| **PR** | (this branch) |

## Symptom

Sentry reported `ReferenceError: OFF_HOURS is not defined` during scheduled/off-hours site latency runs (2026-09-04T05:30Z).

## Root cause

`scripts/site-latency-audit.mjs` passed a `ready` predicate to `page.waitForFunction()` that referenced the Node module binding `OFF_HOURS`. Playwright serializes that function into the browser context where `OFF_HOURS` does not exist.

## Fix

Bake the off-hours row threshold (`5` vs `20`) into a closure at definition time via `dashboardReadyPredicate(minRows)` so the serialized predicate only contains the numeric literal.

## Evidence

- `npx tsx --test scripts/site-latency-audit.test.mjs` — asserts serialized predicate has no `OFF_HOURS` reference.
- `npm run validate:deploy` surfaced the Sentry issue before fix.

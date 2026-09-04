# Site latency audit OFF_HOURS ReferenceError — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P1 |
| **Area** | audit harness / Sentry |
| **Owner** | cursor |

## Symptom

Sentry `ReferenceError: OFF_HOURS is not defined` (2026-09-04T05:30Z) from production
`site-latency-audit.mjs` browser paint pass.

## Root cause

`PAGES[0].ready` closed over the Node constant `OFF_HOURS`, but Playwright
`waitForFunction(fn)` serializes `fn` into the browser context where that binding
does not exist.

## Fix

Pass `minRows` as a `waitForFunction` argument via exported `dashboardMatrixReady(minRows)`
and `readyArg: DASHBOARD_MIN_ROWS` computed in Node.

## Evidence

- `npx tsx --test scripts/site-latency-audit.test.ts` — pass
- Deploy validate GREEN pre-fix; Sentry sample captured in `validate:deploy` output

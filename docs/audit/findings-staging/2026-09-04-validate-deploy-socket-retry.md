# 2026-09-04 — validate:deploy socket-health false warn on transient 503

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `scripts/validate-deploy.mjs`, `scripts/lib/rth-socket-probe.mjs` |

## Symptom

`npm run validate:deploy` warned `socket-health probe HTTP 503` and `options-socket: no recent authenticated line` during RTH even though `npm run validate:rth-open` passed on retry (`ingest leader lock held — marks warming` → green on attempt 2).

## Root cause

`validate-deploy.mjs` issued a single socket-health fetch. The route returns HTTP 503 when marks are still warming; rth-open already retries up to 3 times via `socketProbeAttemptVerdict`, but deploy validation did not.

## Fix

Extracted `probeOptionsSocketWithRetries()` into `scripts/lib/rth-socket-probe.mjs` and wired `validate-deploy.mjs` through the same retry path as `rth-open-check.mjs`.

## Tests

`scripts/lib/rth-socket-probe.test.mjs` — 2 new cases (warming-then-green, exhausted retries).

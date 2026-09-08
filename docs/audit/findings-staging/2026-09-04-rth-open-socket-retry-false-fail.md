# 2026-09-04 — RTH-open socket probe false-fail on retry success

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `scripts/rth-open-check.mjs` |

## Symptom

`npm run validate:rth-open` exited 1 during RTH even though the options-socket probe succeeded on a later retry (`ingest leader lock held — marks warming`). The log showed both `✗` on attempt 1 and `✓` on attempt 2, but the failure from attempt 1 was never cleared.

## Root cause

The socket-health retry loop called `fail()` immediately on a non-ok `opt` response, appending to the `failures` array before subsequent retries could succeed.

## Fix

Extracted `socketProbeAttemptVerdict` / `socketProbeFinalFailure` in `scripts/lib/rth-socket-probe.mjs`. The harness now retries up to 3 times and only records a hard failure after all attempts are exhausted.

## Tests

`scripts/lib/rth-socket-probe.test.mjs` — 5 cases.

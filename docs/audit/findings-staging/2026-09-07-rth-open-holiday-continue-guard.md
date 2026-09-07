# RTH open-check spurious socket retry after holiday skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P3 |
| **Area** | ops / validate:rth-open |
| **PR** | fix/rth-open-holiday-continue-guard |

## Symptom

After #4523 merged, `validate:rth-open` passed but logged a spurious `options-socket (attempt 1/3): HTTP 200 — retrying…` on Labor Day even though the holiday skip was recognized first.

## Root cause

`isSocketHealthSkipped()` set `socketProbeOk = true` but did not `continue` the retry loop; execution fell through to the `else` branch and treated HTTP 200 without websockets as a retryable failure.

## Fix

Add `continue` after holiday skip; guard the HTTP-200 retry branch with `else if (!socketProbeOk)`.

## Evidence

- Pre-fix: spurious retry warning on 2026-09-07 Labor Day
- Post-fix: `npm run validate:rth-open` — clean pass, no retry line

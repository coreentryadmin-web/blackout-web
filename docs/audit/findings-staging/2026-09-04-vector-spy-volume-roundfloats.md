# 2026-09-04 — Vector spy-volume roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Vector API routes |
| **Status** | FIXED |

## Symptom

`GET /api/market/vector/spy-volume` returned raw Polygon minute-bar volume rows without `roundFloats` at the JSON boundary — the last Vector read route missing the policy after #3745/#3756 sweeps.

## Root cause

`spy-volume/route.ts` was not enrolled in `vector-roundfloats-routes.test.ts`, so the hourly pattern scan caught it but the guard test did not block regressions.

## Fix

- Wrap success payload in `roundFloats({ ymd, volumes, available })`.
- Add `spy-volume/route.ts` to the source-scan guard.

## Evidence

- `vector-roundfloats-routes.test.ts` — 9/9 pass including new spy-volume assertion.
- Pattern scan from standing hourly checklist.

## RTH validation

- Open Vector chart on a session where SPY volume backfill fires — network tab `spy-volume` response should show clean 2dp numbers with no IEEE tails.

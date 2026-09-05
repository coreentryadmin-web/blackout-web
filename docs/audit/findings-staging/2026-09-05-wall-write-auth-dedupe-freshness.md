# 2026-09-05 — Vector wall persist debounce + auth failure dedupe future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P3 |
| **Area** | Vector wall-history SSE debounce, Clerk auth-failure beacon dedupe |
| **Status** | FIXED |

## Symptom

Two debounce/dedupe helpers still used raw `Date.now() - at`:

- `persistWallSampleDebounced` — 2s per-bucket debounce before durable wall writes.
- `shouldReportAuthFailure` — 3s identical-message dedupe for auth-failure beacons.

A far-future `at` reads as negative age, satisfying `< window` indefinitely — suppressing wall persists or auth-failure reports past their intended windows.

## Fix

Route both through `isWsUpdatedAtFresh` with the same window constants.

## Evidence

- `vector-wall-write-freshness.test.ts` — source-scan guard.
- `auth-failure-detect-freshness.test.ts` — source-scan guard.
- `auth-failure-detect.test.ts` — behavioral test for future `lastReported.at`.

## RTH validation

- Vector wall-history rail: SSE hub should still debounce duplicate bucket writes within 2s under normal clocks.
- Auth failure beacon: duplicate Clerk errors within 3s still collapse to one report.

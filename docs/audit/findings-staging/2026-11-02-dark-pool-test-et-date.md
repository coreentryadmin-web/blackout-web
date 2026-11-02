# verify RED: dark-pool tests used UTC date vs todayEt() filter

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — `verify` false RED on main |
| **Discovered** | 2026-11-02 CI run 41366602528 on `1c760ad54` |

## Symptom

Two unit tests failed after midnight UTC: `normalizeDarkPoolWsPayload` onlyTicker case (`undefined !== 2`) and `readUwDarkPoolFromRedis` market-wide fallback (`must not be discarded as empty`).

## Root cause

Tests stamped `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC calendar) while production shapers filter on `todayEt()` / `execAtEtYmd` (America/New_York). Between 00:00–04:59 UTC the UTC date is ahead of the ET session date, so all prints were dropped.

## Fix

Use `todayEt()` for synthetic print dates in both test files.

## Evidence

CI log subtests 11065 and 13586; local reproduction possible by running tests when UTC date ≠ ET date.

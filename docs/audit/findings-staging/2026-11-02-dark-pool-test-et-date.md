# 2026-11-02 — verify RED on dark-pool tests using UTC calendar date

> **kind:** FINDING

| **Status** | FIXED (this PR) |
|------------|-----------------|

## Symptom

CI verify failed: dark-pool `onlyTicker` + `readUwDarkPoolFromRedis` fallback tests — `undefined !== 2`.

## Root cause

Tests built `executed_at` with `new Date().toISOString().slice(0, 10)` (UTC) while production filters on `todayEt()` — fails on UTC-morning CI runs still on prior ET session date.

## Fix

Use `todayEt(new Date())` for fixture dates in both test files.

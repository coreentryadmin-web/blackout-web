# RTH deep audit false RED: GEX cold during Polygon circuit pause

> **kind:** `FINDING`

## Symptom

`RTH deep audit` failed at **2026-11-10T20:38Z** (~3:38 PM ET RTH): `data-integrity` + full-site P0 on `getGexPositioning("SPX"/"SPY") returned no matrix while market is open`. Sentry sample on same run showed `[polygon] Circuit open — rate limited, pausing 33s`.

## Root cause

`runDataIntegrityChecks` C6 treated a null matrix during RTH as always actionable. When the shared Polygon breaker is open, `getGexPositioning` cannot rebuild and returns null even if the last good matrix was minutes ago — not a heatmap-warm stall.

## Fix

Skip C6 cold assertions while `isPolygonCircuitOpen()` is true.

## Status

**FIXED** on `fix/rth-audit-gex-circuit`.

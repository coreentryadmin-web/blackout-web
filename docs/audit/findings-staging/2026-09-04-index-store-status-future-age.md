# 2026-09-04 — Index store status ageMs missing future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Polygon index WS / admin health |
| **Status** | FIXED |

## Symptom

`getIndexStoreStatus()` (consumed by `/api/cron/socket-health`, `/api/worker/ready`, admin System Vitals) reported `ageMs` via raw `Date.now() - updatedAt`. A clock-skewed **future** `updatedAt` produced a **negative** age that downstream consumers could misread as a very fresh tick (or display as a bogus small positive if clamped inconsistently).

## Root cause

`getIndexFeedFreshness()` already guards future timestamps (`rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS` → `ageMs: null, stalled: true`), but `getIndexStoreStatus()` duplicated age math without that guard.

## Fix

Derive each symbol's `ageMs` from `getIndexFeedFreshness(sym).ageMs` so admin health and socket-health share one code path.

## Evidence

- Source-scan regression: `src/lib/ws/polygon-index-freshness.test.ts`
- Pattern from hourly checklist §3 (future timestamp without guard)

## RTH validation

- During RTH, `/admin` → Operations → Polygon indices tile should show sensible ages (not negative / "just now" on a stalled feed).
- `GET /api/cron/socket-health` → `polygon_indices.symbols[].ageMs` null when feed is clock-skewed future, not a small positive number.

> **kind:** FINDING

# Index store status future-timestamp age guard — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P3-0107 |
| **Priority** | P3 |
| **Status** | FIXED |
| **Branch** | `fix/index-store-status-future-age-guard` |

## What was broken

`getIndexStoreStatus()` reported `ageMs: Date.now() - updatedAt` per symbol without the future-skew guard that `getIndexFeedFreshness()` already applies. Clock-skewed future `updatedAt` values could surface as negative ages in admin/ops health endpoints (`socket-health`, `admin-health`, `market-health`, `worker/ready`).

## Fix

Delegate per-symbol `ageMs` to `getIndexFeedFreshness(sym)` so future timestamps read as `null` age (stalled) instead of negative.

## Evidence

- Static regression: `polygon-socket-index-status.test.ts`
- Pattern scan during hourly wake 2026-09-05

## Blast radius

Admin/ops health JSON only — no member-facing desk numbers.

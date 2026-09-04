## 2026-09-04 — [P2, Largo/BIE] `getBieFullStateForLargo` treated clock-skewed future `asOf` as fresh — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — stale Redis `bie:full-state` could be served as live when `asOf` is in the future |
| **Found by** | Cursor Autopilot hourly bug-pattern scan |
| **Status** | FIXED |

### Root cause

`isFresh()` in `full-platform-loader.ts` used `Date.now() - Date.parse(asOf) <= LIVE_MAX_AGE_MS` with no
future guard. A clock-skewed future timestamp yields negative age, which always satisfies the 5-minute ceiling.

### Fix

Reject when `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; compare `Math.max(0, ageMs)` against `LIVE_MAX_AGE_MS`
(matching `admin-store-age.ts` / `FreshnessChip` pattern).

### Blast radius

`src/lib/bie/full-platform-loader.ts` only — Largo cross-product snapshot read path.

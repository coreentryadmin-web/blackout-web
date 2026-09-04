# Admin SPX terminal lib incident open-duration — clock-skew guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | admin / SPX terminal feed |

## Symptom

`buildSpxTerminalFeed` in `src/lib/admin-spx-terminal.ts` computed incident open duration as
`Date.now() - new Date(inc.opened_at)` without a future-timestamp guard. A clock-skewed
`opened_at` produced a negative duration that rendered as `open -Ns` in the terminal meta line.

## Root cause

#3660 fixed the React `AdminSpxTerminal` component and `AdminApiLiveFeed` via
`admin-time-ago.ts`, but the server-side feed builder in `src/lib/admin-spx-terminal.ts` still
used the unguarded subtraction for open incidents.

## Fix

Reuse `isoAgeSec` from `admin-time-ago.ts` for incident open labels (`open clock skew` /
clamped seconds). Clamp `AdminSpxDashboard` stale detection and `TrackRecordView` freshness age
with `Math.max(0, …)`.

## Evidence

`npx tsx --test src/lib/admin-spx-terminal.test.ts` — future-skewed incident meta reads
`open clock skew`; past incident reads `open 120s`.

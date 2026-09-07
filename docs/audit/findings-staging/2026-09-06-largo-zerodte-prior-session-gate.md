# Largo swing brief — prior-session 0DTE treated as live cross-desk signal — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-zerodte-prior-session-gate |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`crossDeskCoaching`, `counterThesisLine`, and `flowIntelSection` consumed `eco.zerodte_today`
whenever non-null, without checking `zerodte_today.session_date === ctx.sessionDate`. After the
close or before today's 0DTE board refreshes, yesterday's short/long stance could still produce
live-looking lines like `0DTE short (score …)` / `Cross-desk friction` / `0DTE desk: **short** ·
**conflict**`. Vector and HELIX already had stale gates; 0DTE did not.

## Fix

- Added shared `zerodteLiveForSession()` in `play-brief-absence.ts` (same pattern as
  `trustedHelixFlow`).
- Gated all three call sites on session-date match before using 0DTE direction/score.

## Evidence

`npx tsx --test` on `play-brief-absence.test.ts`, `play-brief-narrative-coaching.test.ts`,
`play-brief-narrative.test.ts`, `play-brief-intel.test.ts` — prior-session regression cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |

# Largo swing brief — prior-session Night Hawk stance treated as live cross-desk signal — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-nighthawk-prior-session-gate |
| **Pri** | P2 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |

## Symptom

`crossDeskCoaching` and `counterThesisLine` consumed `eco.nighthawk_recent.direction` whenever
non-null, without verifying `nighthawk_recent.edition_for === ctx.sessionDate`. Upstream fetches the
latest Night Hawk edition regardless of session (unlike 0DTE, which is scoped to `todayEtYmd()`), so
after the close or before today's swing board refreshes, yesterday's bearish/bullish stance could
still produce live-looking cross-desk friction and counter-thesis lines — the same Largo C2 dishonesty
class fixed for 0DTE in #4424.

## Fix

- Added shared `nighthawkLiveForSession()` in `play-brief-absence.ts` (mirrors `zerodteLiveForSession`).
- Gated `crossDeskCoaching` and `counterThesisLine` on edition/session-date match before using NH direction.
- Left `deskConsensusSection` untouched — it intentionally renders dated historical outcomes.

## Evidence

`npx tsx --test` on `play-brief-absence.test.ts`, `play-brief-narrative-coaching.test.ts`,
`play-brief-narrative.test.ts` — prior-session NH regression cases pass.

| **Status** | FIXED — PR opened, merge pending CI/peer-review |

# Three market_hours_only crons still polled upstream on Labor Day — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-cron-holiday-gates-batch2 |
| **Priority** | P3 |
| **Area** | Cron infra / UW+Polygon rate budget |
| **Status** | FIXED |

## Symptom

Post-#4482/#4483 audit sweep of remaining `market_hours_only: true` crons. On Labor Day
2026-09-07, three routes still executed real upstream work on EventBridge's weekday schedule:

- `swing-active-refresh` — Polygon option snapshots + UW IV rank per open swing position
- `banger-live-sync` — Polygon unified option snapshot marks for open banger positions
- `helix-signal-outcomes` — DB record/grade churn with no live tape to grade against

## Root cause

Same ET-INTENT class as `uw-cache-refresh` (#4482) and `flow-ingest` (#4483): registry declares
`market_hours_only: true` but routes had no `isEtCashRth()` execution gate.

## Fix

Added holiday-aware RTH gate after auth (and after `requireDatabaseInProduction` where applicable),
returning `{ ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" }`.

**Correction during review (independent Claude peer review on the PR):** `swing-active-refresh`
and `banger-live-sync` correctly use `isEtCashRth()` — neither does any deferred post-close work.
`helix-signal-outcomes` does not fit that pattern: `gradeHelixSignalOutcomes` grades a 1h checkpoint
per firing, so a firing near the close needs grading ~1h later, past the 16:00 ET cash close. The
deployed EventBridge schedule (`*/15 13-21 * * 1-5` UTC, blackout-infra `cron-jobs.json`) is
deliberately wide — 9:00-17:00 ET under EDT — specifically so that margin exists. `isEtCashRth()`'s
hard 16:00 cutoff would have removed it, delaying last-hour-of-session checkpoint grading by ~17h
to the next trading day's first fire instead of the intended <=60min. Switched this one route to
`isEtExtendedWarmHours()` (4:00-20:00 ET, same holiday-awareness via `isTradingDayEt`) — closes the
Labor Day gap this PR targets while preserving the post-close grading window.

## Blast radius

Three routes only. RTH behavior unchanged (aside from the `helix-signal-outcomes` gate correction
above, which widens rather than narrows its execution window — still closed on weekends/holidays).
Remaining ungated `market_hours_only` crons documented for follow-up: `socket-health` (partial
gate), `gex-alerts`/`vector-alerts` (push kill-switch), `legacy-live-sync`.

## Evidence

RED→GREEN static tests in each route's `route.test.ts`, 12/12 pass:
`node --import tsx --experimental-test-module-mocks --test src/app/api/cron/swing-active-refresh/route.test.ts src/app/api/cron/banger-live-sync/route.test.ts src/app/api/cron/helix-signal-outcomes/route.test.ts src/app/api/cron/flow-ingest/route.test.ts src/app/api/cron/uw-cache-refresh/route.test.ts`
`npx tsc --noEmit` — clean.

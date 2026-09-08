# SPX desk flow freshness — future-skewed print reads as 0ms live (Largo/desk age-0 trap) — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-flow-data-freshness-future-skew |
| **Priority** | P2 |
| **Area** | SPX Slayer desk / flow staleness gate |
| **Status** | FIXED |

## Symptom

Found while sweeping for other instances of the age-0 future-skew trap after #4471 (options
cluster marks), #4472 (Largo `matrix_age_sec`/tape coverage), and #4473 (Largo rail-level ladder)
all fixed the same class same day. `newestFlowAgeMsFromBriefs()` in `src/lib/flow-data-freshness.ts`
computed `newest` directly from each flow's `alerted_at` and returned `Math.max(0, now - newest)`
— a clock-skewed-future `alerted_at` (bad source data, clock skew upstream) would report as **0ms
old** instead of unusable.

Unlike its sibling `flowDataAgeMs()` — protected because `markFlowDataFresh()` already rejects a
timestamp more than 60s ahead of the real clock before it can ever become `lastFlowDataAt` —
`newestFlowAgeMsFromBriefs()` recomputes `newest` fresh on every call straight from the raw
payload, with no equivalent guard. `resolveFlowDataAgeMs()` (the function SPX Slayer's
`deskFlowDataAgeMs()` actually calls to gate flow-staleness for the play system) takes
`Math.min(fromTape, fromMem)` — so a single bad future-skewed print would win that `min` and
report the WHOLE desk's flow data as freshly live, potentially unblocking entries on a stale/bad
read.

## Root cause

`Math.max(0, now - t)` silently clamps any negative age (t in the future) to 0 — "unknown/bad"
renders as "current," the single most dangerous rounding on a trading desk. Same root cause as
#4471/#4472/#4473, just a fourth, previously-undiscovered call site found by grepping the repo
for the pattern after those three merged.

## Fix

`newestFlowAgeMsFromBriefs()` now applies the same `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` (5s)
fail-closed check used everywhere else in the WS-freshness family: a timestamp more than the
tolerance ahead of `now` returns `null` (unusable) rather than a clamped age. `flowDataAgeMs()`
itself needed no change — it was already protected upstream via `markFlowDataFresh()`'s existing
60s future-rejection guard.

## Blast radius

Single call site chain: `newestFlowAgeMsFromBriefs` → `resolveFlowDataAgeMs` → SPX Slayer's
`deskFlowDataAgeMs` (`src/features/spx/lib/spx-desk.ts`) — the flow-staleness signal feeding the
SPX Slayer play system's desk state. No other consumer of `newestFlowAgeMsFromBriefs` exists.

## Evidence

RED→GREEN: pre-fix, a future `alerted_at` (`"2026-06-29T16:10:00.000Z"` vs `now`
`"2026-06-29T16:00:00.000Z"`) returned `0`; post-fix returns `null` — new regression test
`newestFlowAgeMsFromBriefs: clock-skewed future alerted_at is null, not 0ms fresh (age-0 trap)` in
`src/lib/flow-data-freshness.test.ts` fails on the old code, passes on the new. Full file:
`node --import tsx --experimental-test-module-mocks --test src/lib/flow-data-freshness.test.ts` —
3/3 pass. `npx tsc --noEmit` — clean. No regression in SPX desk consumers:
`spx-desk-ws-freshness.test.ts`, `spx-desk-stale.test.ts`, `spx-desk-closed-placeholder.test.ts` —
7/7 pass.

Also grepped `src/` for remaining `Math.max(0, now - ...)`/`Math.max(0, ... - t)` patterns after
this fix: the other hits (`TrackRecordView.tsx`, `FlowFeed.tsx` client component, `VectorChart.tsx`
`dataAgeMs`, `SpxPulseRail.tsx`, `relative-time.ts`) are all client-side same-clock reads (own
`Date.now()` vs a value received on the same clock — future skew across a network hop isn't
possible the way it is for a server-parsed external timestamp) or display-only relative-time
strings, not freshness-gating trust signals — lower risk, not addressed here to keep this PR
single-issue. `swing-active-refresh/route.ts`, `spx-play-outcomes.ts`, and
`thermal-session-events.ts` compute day/whole-session-scale ages where a few seconds of skew is
immaterial to the derived value; also left out of scope.

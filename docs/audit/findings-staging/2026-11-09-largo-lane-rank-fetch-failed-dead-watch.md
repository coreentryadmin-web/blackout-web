# laneRowsFetchFailed (Largo C3) disclosure wrongly suppressed for dead/expired WATCH plays

> **kind:** `FINDING`

**Status.** FIXED.

## Root cause

`collectBriefUnavailableSources()` (`src/lib/swing/play-brief-absence.ts`) gated the "Lane rank"
fetch-failure chip on `!isNotLive`, where `isNotLive = isClosed || isDeadWatch` (`isDeadWatch`
covers a non-OPEN/HOLD/TRIM play whose entry window/thesis has already died, per
`deadPlayReason()` — e.g. an expired WATCH candidate).

The CLOSED half of that gate is correct: `computeLaneRank`'s own `bucketFor()`
(`src/lib/swing/play-brief-lane-rank.ts`) short-circuits to `null` unconditionally for
`status === "CLOSED"`, before it ever looks at `laneRows` — so for a CLOSED play the Lane Rank
section never renders regardless of whether the underlying fetch succeeded or failed, making the
disclosure chip moot.

The dead-WATCH half is **not** moot. `laneRankSection()` (`src/lib/swing/play-brief-intel.ts`,
inside `buildIntelSections()`) is invoked unconditionally for every bucket — no dead-WATCH skip —
and `bucketFor()` returns `"watch"` (not `"closed"`) for a dead-but-not-CLOSED play, so
`computeLaneRank` proceeds to actually use `laneRows`. A genuine fetch failure there (empty
`laneRows`, from `loadLaneRows`'s own `.catch(() => null)` in `play-brief-resolve.ts`) is
byte-identical in shape to a legitimately thin peer pool (`peers.length < 2 → return null`) — the
exact Largo C3 "no signal vs no data" ambiguity this chip exists to resolve, now silently
unresolved for the one bucket where it actually matters.

This also understated `swingPlayBriefConfidence()` risk: that function derives its confidence
level purely from `unavailableSources.length`, so a dead-WATCH brief suffering a genuine
lane-fetch outage reported a wrongly-optimistic confidence, identical to what a healthy fetch
would report.

Found and independently verified (adversarial-verify, standing Ask Largo mandate) via a live
repro: `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR` (a real dead-WATCH
candidate, entry window expired) rendered a full populated "Lane rank" section
("#13 of 14 on WATCH lane · score 15 (-40 vs median) ... Desk leader: NVDA @ 85.4"), confirming
`laneRankSection` is genuinely reachable and non-moot for this bucket.

Three sibling fetch-failure flags in this same file (`archetypeTrackRecordFetchFailed`,
`rollHistoryFetchFailed`, `tickerTrackRecordFetchFailed`) were hardened to disclose "regardless of
play status" earlier today (PR #7688) — `laneRowsFetchFailed` was the one remaining sibling still
carrying the stale `!isNotLive` gate (confirmed via git history: `laneRowsFetchFailed`'s
disclosure, PR #5947, was added AFTER `isDeadWatch`/`isNotLive`, PR #5264, and the gate was
pattern-matched from the CLOSED exemption without re-checking it against this section's own
rendering gate).

The existing unit test for this flag passed a bare `{ laneRowsFetchFailed: true }` context with
no `play` field at all, which makes `isDeadWatch` structurally false (it requires
`ctx.play != null`) — so the dead-WATCH sub-case of this exact flag had never been exercised by
any test.

## Evidence (RED → GREEN)

Two new tests added to `play-brief-absence.test.ts`:
- `"laneRowsFetchFailed still surfaces a Lane rank chip for a dead (but not CLOSED) WATCH play"` —
  confirmed RED pre-fix (the chip was absent); GREEN post-fix.
- `"laneRowsFetchFailed is still suppressed for a CLOSED play ..."` — guards the still-correct
  CLOSED exemption, passed both before and after (confirming the fix doesn't regress it).

Full `play-brief-absence.test.ts`: 123/123 pass. Broader regression
(`play-brief-intel.test.ts`/`play-brief-confidence.test.ts`/`play-brief.test.ts`): 581/581 pass.
`npx tsc --noEmit` clean.

## Blast radius

One `if` condition in one file. `laneRowsFetchFailed` has no other consumer (confirmed via
repo-wide grep) besides this chip and `swingPlayBriefConfidence`'s length-based count, both of
which now correctly see the disclosure for the dead-WATCH case.

## Fix rationale

Changed the gate from `!isNotLive` to `!isClosed` — the narrower, correct condition that matches
`computeLaneRank`'s own CLOSED-only short-circuit exactly, rather than reusing the broader
`isNotLive` union that was never re-verified against this specific section's rendering behavior.
No other check in this file was touched.

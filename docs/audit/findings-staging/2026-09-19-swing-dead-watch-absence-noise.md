> **kind:** FINDING

## Ask Largo — dead WATCH plays still show the "wall of stale chips" the CLOSED-play fix was written to prevent

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo (`docs/audit/LARGO-PRODUCT-CONTRACT.md` C3 absence) |
| **File** | `src/lib/swing/play-brief-absence.ts` |

### Root cause

`collectBriefUnavailableSources` (the function that decides which `unavailableSources`/
`UnavailableChip` entries a swing play brief shows) already has an `isClosed` gate, added earlier
this cycle with this exact reasoning in its own comment:

> "CLOSED plays are a historical record, not a live position... Left ungated, these are
> individually honest but collectively permanent once ANY time has passed since close — every one
> of them fires forever, producing a wall of true-but-unhelpful negative chips with no positive
> content (reported live: a screenshot of a CLOSED AAPL play showing six such chips and nothing
> else)."

That reasoning applies identically to a **dead WATCH play** — one where `deadPlayReason()`
(`entry-enterability.ts`) resolves non-null because the thesis is already `INVALIDATED`, the
entry-validity deadline has passed (`watchEntryExpired`), the contract has expired
(`entryStatus === "EXPIRED"`), or the setup ran `EXTENDED` past its valid entry window. A dead WATCH
play is exactly as "not live" as a CLOSED one: nothing is going to enter it, and the brief itself
already says so elsewhere in the same envelope (`tradeManagerNarrativeSection`'s "Break watch"
bullet: *"this setup is no longer live — skip it"*).

But `play-brief-absence.ts` never imported `deadPlayReason` at all, while three sibling files that
also reason about "is this play actually actionable" already do:
- `play-brief.ts` — the top-level Invalidation callout and the Entry-trigger line
- `play-brief-intel.ts` — `entryTriggerDeadReason`
- `play-brief-narrative-coaching.ts` — the cross-desk coaching's "moot gate" qualifier

So every live-desk-staleness check in this file (HELIX flow freshness, GEX/Vector staleness+desk
state, prior-session discovery scan / 0DTE board / Night Hawk Legacy edition) kept firing forever
on a dead WATCH play, producing the identical unhelpful-chip-wall defect the CLOSED-play fix
targeted — arguably a worse instance of it, since nothing re-scans a candidate nobody can act on
anymore, so its Vector/GEX/HELIX reads keep aging with no refresh ever clearing them.

### Evidence

- Read-through of `play-brief-absence.ts`'s `isClosed` gate against `deadPlayReason`'s three other
  call sites confirmed the gap: `deadPlayReason` was never imported in this file.
- Live check (2026-09-19, `GET /api/market/swing/play-brief?playId=SWING:LITE&ticker=LITE`, cron
  auth): a live (not dead) WATCH play already carries 6 `unavailableSources` chips (HELIX flow
  stale, 3× Vector-section-absent, swing-discovery-scan prior-session, Night Hawk Legacy
  prior-session) — confirming this machinery is very actively firing on WATCH plays today, so a
  dead WATCH play accumulating the same set with zero actionability left is a real, live-reachable
  shape, not a hypothetical one.
- RED→GREEN: added 4 regression tests to `play-brief-absence.test.ts` (a dead-WATCH play via
  `watchEntryExpired`, a dead-WATCH play via `setupState: "INVALIDATED"`, a control proving a
  still-live WATCH play keeps surfacing staleness, and a control proving an OPEN position with a
  leftover `entryStatus: "EXPIRED"` value is NOT treated as dead — the check is WATCH-bucket-only).
  Confirmed RED against the pre-fix source (`git stash` the source file only, tests fail 2/72),
  GREEN after the fix (72/72).

### Fix

Added an `isDeadWatch` check alongside the existing `isClosed` one, scoped to the WATCH bucket only
(mirroring `deadPlayReason`'s two existing call sites, both gated on `bucket === "watch"` — the
same `setupState`/`entryStatus`/`watchEntryExpired` fields carry different meaning once a position
is live, so this deliberately does NOT apply to OPEN/HOLD/TRIM). Replaced every `!isClosed` guard
in the function with `!isNotLive` (`isClosed || isDeadWatch`), so a dead WATCH play now gets the
exact same suppression a CLOSED play already got. Genuine fetch failures
(`ecosystemFetchFailed`/`vectorFetchFailed`/Meridian-`unavailable`) are still NOT suppressed — those
indicate the read itself broke, which stays true regardless of the play's status, exactly as the
CLOSED-play gate already preserved.

### Blast radius

Single file, single function. No other call site reads `isClosed`/`isNotLive` from this file. No
gate, scoring, or narrative-prose logic changed — only which absence chips reach
`envelope.unavailableSources` for the dead-WATCH subset of plays.

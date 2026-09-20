## Swing `dataHonestyCoaching` warned about live-data staleness for a dead WATCH play — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `dataHonestyCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (member-facing narrative quality / absence-as-fact discipline) |
| **Status** | FIXED |

### Root cause

`collectBriefUnavailableSources` (`play-brief-absence.ts`) just gained a guard (PR #5264, same day)
suppressing its live-desk-staleness chips for a WATCH play whose entry is already dead
(`deadPlayReason()` — thesis invalidated, entry-validity deadline passed, contract expired, or
extended past the valid entry window) — the same reasoning that function's own `isClosed` gate
already applied to CLOSED plays: "nothing re-scans a dead candidate to ever refresh its reads," so a
staleness warning about it is a permanent, uninformative state, not a transient one worth flagging.

`dataHonestyCoaching`, a sibling function in a different file, reads the SAME four live-desk signals
(Vector age, GEX matrix age, HELIX pipeline freshness, discovery-scan session mismatch) into one
"Data caveat" prose bullet — but never imported `deadPlayReason` for them. `watchGateCoaching` (this
same file, a few lines up) and `play-brief.ts`'s top-level Invalidation callout both already gate on
it; this function, called from the identical WATCH-bucket path (`collectCoachingBullets`), did not.
So a dead WATCH play kept accumulating "Vector stale" / "GEX matrix stale" / "HELIX pipeline stale" /
"swing discovery ... not yet run" warnings about a setup the brief itself already narrates as
"no longer live — skip it."

The fifth check in the same function (option-mark staleness) was already correctly silent for WATCH
plays via `collectOptionMarkStalenessAbsence`'s own internal `playExpectsLiveOptionMark` gate (OPEN/
HOLD/TRIM only) — that one needed no change.

### Evidence

Confirmed via full-file read: none of the Vector/GEX/HELIX/discovery-scan branches in
`dataHonestyCoaching` (pre-fix) checked `play.status` or `deadPlayReason` at all. Confirmed
`collectCoachingBullets` (this file) calls `dataHonestyCoaching` unconditionally for `bucket ===
"watch"` (only `bucket === "closed"` early-returns before reaching it) and that `statusBucket`
(`play-brief.ts`) maps purely on `play.status`, with no `deadPlayReason` involvement — so a dead
WATCH play's `status` stays `"WATCH"` and it still reaches `dataHonestyCoaching` on every read.

### Blast radius

Single function. No other call site in this file duplicates these four checks. `watchGateCoaching`
(already correctly gated), `collectBriefUnavailableSources` (already fixed by #5264), and
`play-brief.ts`'s Invalidation callout (already fixed 2026-09-18) are untouched.

### Fix rationale

Adds `const dead = <WATCH-only guard> ? deadPlayReason(play) : null;`, gating the same idiom PR
#5264 introduced (`status !== "OPEN" && status !== "HOLD" && status !== "TRIM" && status !==
"CLOSED"`) — OPEN/HOLD/TRIM carry the same `setupState`/`entryStatus`/`watchEntryExpired` fields with
leftover pre-entry values that must not be reinterpreted once a position is live, so the guard is
deliberately WATCH-only, not a bare `deadPlayReason(play) != null`. Each of the four staleness checks
is prefixed with `!dead &&`. The option-mark check is untouched (already correctly N/A for WATCH via
its own gate).

### Tests

Four new tests in `play-brief-narrative-coaching.test.ts`:
- dead WATCH (entry-validity expired) suppresses Vector staleness
- dead WATCH (thesis invalidated) suppresses GEX/HELIX/discovery-scan staleness
- a live (not dead) WATCH play still warns (no regression, control)
- an OPEN play with a leftover pre-entry `setupState` still warns (proves the guard is WATCH-only,
  not a bare deadPlayReason check that could misfire on OPEN/HOLD/TRIM)

RED→GREEN proven via `git stash` isolating the source fix from the tests: reverting only the source
file reproduces exactly 2 failures (the two positive dead-WATCH-suppression tests); restoring the fix
returns to 119/119 pass in this file. `npx tsc --noEmit`: clean. Full `npm test` (Node 20): 14890
pass / 0 fail / 3 skipped (pre-existing, unrelated).

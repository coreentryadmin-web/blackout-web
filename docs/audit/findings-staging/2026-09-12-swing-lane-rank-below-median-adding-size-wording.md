> **kind:** FINDING

## Lane-rank "below median" caution told a member to "confirm before adding size" on a position already being trimmed — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`computeLaneRank`/`laneRankCoaching`/`laneRankSection` (`src/lib/swing/play-brief-lane-rank.ts`,
`play-brief-narrative-coaching.ts`) already special-case the rank-1 self-praise line for an
invalidated thesis (#4842, merged earlier the same day — SKHY). The below-median caution has the
same class of gap on a different play state: it tells the member "confirm before adding size"
purely from `deltaFromMedian < -15`, with no check on the play's own `manageAction`.

**Live repro (2026-09-12):** CG sat **#90/90** (dead last) among all committed positions by raw
*entry-time* score (3) — while being the single best-performing REAL position in the book
(**+169.2% mid / +134.6% executable**), already on `manageAction: TAKE_PARTIAL`. Its own brief's
**Trade manager read** led with:

> **Desk says TRIM** — next rail at **+100%**. Bank partial into strength; don't give back peak.

Three bullets later, the same folded narrative said:

> **Below lane median** — **#90/90** (score **3**, -60 vs median). Leader: **AAPL** @ **84.4** —
> confirm before adding size.

Telling a member to "confirm before adding size" on the exact position the desk just told them to
bank profit on is backwards advice — the entry-time score standing is real, honest context, but the
"adding size" framing assumes a hold/entry-sizing decision that doesn't match this play's actual
state.

### Fix

Added a `selfReducing` flag to `LaneRankSnapshot`, true when the play's own `manageAction` is
`TAKE_PARTIAL`/`EXIT_RUNNER`/`STOP_OUT`/`EXIT` (distinct from `EXITING_MANAGE_ACTIONS`, which gates
the *named peer* pointer, not this play's own caution). When a below-median play is also
`selfReducing`, both `laneRankSection` and `laneRankCoaching` render a variant that keeps the honest
rank/score standing but drops the "confirm before adding size" / "Leader: X — confirm before adding
size" framing, replacing it with an explicit "not a sizing signal here — this position's own plan
already calls for reducing, not adding." A plain `HOLD` (or `ADD`) still gets the original wording
unchanged — the fix is additive, gated narrowly on the reduce-action set.

### Blast radius

Both consumers of `computeLaneRank` are fixed by the one change. Only the below-median branch is
affected; the rank-1/top-tier branches (already fixed by #4842) and the rank/median math itself are
untouched.

### Fix rationale

Same shape as #4842: keep the honest numeric standing, gate only the action-implying tail on the
play's own real state. Minimal, additive, no new computation beyond a field already available on
`TerminalPlay` (`manageAction`).

### Evidence of testing

- 6 new tests: `selfReducing` true only for the play's own reduce-action state;
  `laneRankSection`/`laneRankCoaching` both drop "adding size" wording when `selfReducing`, and both
  keep the original wording for a plain `HOLD` (regression guard).
- RED→GREEN proven via `git stash` — 3 of the new/touched assertions fail pre-fix, pass post-fix.
- `play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` (89 tests combined): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): pass, 0 fail (see PR for exact count).

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate — a fresh
full-envelope forensic pass on CG (the strongest real winner in the book) right after confirming
#4842's SKHY fix deployed live.

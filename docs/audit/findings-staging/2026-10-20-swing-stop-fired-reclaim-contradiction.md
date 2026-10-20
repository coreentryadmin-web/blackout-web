## A CLOSED+stopped swing play-brief told a member the stop wasn't wrong, then two sections later told them it may have been too early — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo × Night Hawk Swings standing mandate — a fresh-angle Workflow
audit of the play-brief's "Flow & positioning"/"Hold plan"/"Lessons"/"Since it closed" sections,
adversarially verified (2 independent passes, confirmed real on both).

**Root cause:** `closedCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`, feeds "Trade
manager read") and `watchForSection` (`src/lib/swing/play-brief-intel.ts`, feeds "Since it
closed") both read a CLOSED+stopped play's pinned `entryTriggerUnderlyingPx`/
`invalidationUnderlyingPx` levels, but were written independently and never cross-checked what the
combined rendered document says:

- `closedCoaching`'s "Stop fired" bullet (added 2026-09-28, PR referenced in that fix's own
  comment) unconditionally concluded, whenever both levels were present: *"a thin cushion here
  means the entry was already extended, not that the stop was wrong."* — a blanket verdict that
  the stop itself was not premature.
- `watchForSection`'s "Since it closed" reclaim check (added 2026-10-13) independently compares
  the SAME `invalidationUnderlyingPx` against the CURRENT live spot and, whenever spot has since
  moved back through that level in the favorable direction, renders: *"Spot has since reclaimed
  the stop level ... the exit may have been early."* — the opposite verdict.

The 2026-10-13 fix's own comment explicitly frames itself as answering "a DIFFERENT question" from
the 2026-09-28 line, which is true in isolation, but neither fix checked what happens when both
render in the same response — which they do on every closed+stopped position whose underlying has
since mean-reverted through the stop, a routine, non-rare occurrence, not an edge case.

**Live impact:** real, reproduced on two live production positions today (`GET
/api/market/swing/play-brief`, 2026-10-20):

- **CRWV:61** — "Trade manager read": *"**Stop fired** (stopped) — entry **62.34** vs
  invalidation **57.06**, a **+8.5%** cushion at commit; a thin cushion here means the entry was
  already extended, not that the stop was wrong."* Later in the same envelope, "Since it closed":
  *"Spot has since reclaimed the stop level (**57.06**) — now **57.80**, 1.3% back through it; the
  exit may have been early."*
- **MSFT:49** — same shape: *"... not that the stop was wrong."* followed later by *"... the exit
  may have been early."*

A member reviewing either closed trade for lessons reads two directly conflicting judgments about
the identical stop-fire event, one clearing it and one implicating it, with nothing in either
section acknowledging the other.

**Fix:** `closedCoaching` now accepts the brief's own `spot` (already computed once per compose
and threaded through `collectCoachingBullets`, the function's only real call site — no new I/O,
no new staleness risk, and the same derivation `watchForSection` itself uses so the two can't
independently drift into a *second* disagreement over what "spot" means). When spot has reclaimed
the invalidation level (computed with the identical direction-aware comparison `watchForSection`
uses), the trailing clause now reads *"spot has since moved back through this level — see 'Since
it closed' below for how far."* instead of asserting a verdict that section can contradict. When
spot has NOT reclaimed the level (the common case — stop confirmed), the original "not that the
stop was wrong" framing is unchanged, since nothing in that case contradicts it.

**Fix rationale:** `watchForSection`'s reclaim line already carries real, dated post-close
evidence (how far back through the level, as of today) — it is the authoritative source for "what
has the underlying done since." `closedCoaching`'s line is a commit-time fact (the cushion at
entry) that should not also assert a post-close verdict it has no evidence for. Deferring rather
than duplicating or deleting keeps both sections' distinct, valid facts (the commit-time cushion
number stays visible either way) while removing the one clause that could contradict a later
section. `spot` defaults to `undefined` in the function signature, so every existing caller/test
that doesn't pass it keeps the prior (non-reclaimed) behavior — no silent behavior change for the
generic-prompt fallback branch (missing level data) or any other `closedReason`.

**Blast radius:** `closedCoaching` has exactly one production call site
(`collectCoachingBullets`, same file), which already had `spot` available as a parameter it wasn't
forwarding — a one-line threading fix, not a new computation. No other section reads
`entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` for a stopped-play verdict.

**Tests:** 4 new regression tests in `play-brief-narrative-coaching.test.ts` (reclaimed LONG,
reclaimed SHORT, not-reclaimed-no-regression, no-spot-argument-safe-default) — all fail against
the pre-fix code (verified via `git stash`) and pass after. Full suite green on Node 20
(16400+/16400+, 0 fail) plus `tsc --noEmit` clean.

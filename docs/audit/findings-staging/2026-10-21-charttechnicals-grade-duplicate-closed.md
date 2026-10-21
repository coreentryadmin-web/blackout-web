## chartTechnicalsSection re-duplicates the Vector grade fact vectorDeskSection already owns, on CLOSED briefs — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive, round 2 (live-
fetched real swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified
before acting), focused on "Chart technicals"/"Chart levels" — sections not yet audited that day.

**Root cause:** `chartTechnicalsSection` (`src/lib/swing/play-brief-intel.ts`) pushes
`Vector desk grade: **${vec.play.grade}**` unconditionally for any bucket once past its stale-return
guard. The 2026-10-13 fix (and its own test) correctly eliminated this exact duplicate for
OPEN/WATCH by returning `null` whenever Vector was stale, reasoning that grade "is not chart-
technicals data... whose canonical home is vectorDeskSection." The 2026-10-17 follow-up narrowed
that stale-return to `if (vectorStale && bucket !== "closed") return null;` specifically so CLOSED
briefs would still show EMA/RSI/structure instead of silently vanishing — but it never re-gated the
downstream grade push alongside it, so the grade line reappeared for every CLOSED brief regardless
of staleness. Meanwhile `vectorDeskSection`'s own `bucket === "closed"` branch unconditionally
renders `Current Vector read: grade **${p.grade}** · conviction **${p.conviction}** (since this
play closed)` for the identical data — so the same grade fact now prints twice under two section
titles on every real CLOSED brief, with no dedup flag between the two call sites (unlike the several
`...AlreadyNoted` guards this file uses for other duplicate-fact pairs).

**Evidence:** Two live CLOSED positions reproduce it directly. NVDA (positionId 62): "## Chart
technicals" renders "Vector desk grade: **C**", and later in the SAME envelope "## Vector desk"
renders "Current Vector read: grade **C** · conviction **42** (since this play closed)". CRWV
(positionId 61): identical shape, "Vector desk grade: **C**" then "Current Vector read: grade **C**
· conviction **8** (since this play closed)". The 2026-10-17 fix's own CLOSED-bucket regression
test used a fixture with `play: { grade: "A" }` (so the grade line fired) but never asserted on the
grade line's presence/absence or cross-referenced `vectorDeskSection` the way the 2026-10-13 test
did — so the reopened duplicate had no test coverage.

**Fix:** `src/lib/swing/play-brief-intel.ts` — gated the grade push with `&& bucket !== "closed"`,
mirroring the stale-return's own bucket-gating a few lines above. `vectorDeskSection` already owns
this fact for CLOSED briefs per its own doc comment ("Closed briefs keep only the informational
grade/conviction snapshot").

**Tests:** `src/lib/swing/play-brief-intel.test.ts` — new test mirroring the existing 2026-10-13
cross-check (`chartTechnicalsSection + vectorDeskSection: stale Vector never renders the same grade
fact under both titles`) for the CLOSED bucket specifically: asserts `chartTechnicalsSection`'s
CLOSED output still carries EMA/RSI/structure but never "Vector desk grade", while
`vectorDeskSection`'s CLOSED output remains the one place that reports it. RED→GREEN proven via
`git stash` on the source file alone (1 fail / 305 pass without the fix, 306/306 with it). `tsc
--noEmit` clean.

**Blast radius:** `chartTechnicalsSection`'s CLOSED-bucket grade line only — OPEN/WATCH behavior
(already correctly gated since 2026-10-13) and every other line in both sections are untouched.

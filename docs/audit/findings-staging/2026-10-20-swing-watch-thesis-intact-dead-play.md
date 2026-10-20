> **kind:** FINDING

## Swing play-brief — `watchForSection` "Thesis intact" contradicted a dead WATCH play's own neighboring line — FIXED

| **Status** | Fixed (PR TBD) |
|---|---|

**Found:** 2026-10-20, Ask Largo standing deep-dive cycle, live-audited by a background workflow
agent testing `GET /api/market/swing/play-brief` across OPEN/WATCH/CLOSED buckets.

**Root cause:** `watchForSection` (`src/lib/swing/play-brief-intel.ts`, the "Watch levels" section
of the swing play-brief) renders a `Thesis **${play.thesisBreak.level}**` line for any non-closed,
non-Banger-origin play that carries a `thesisBreak`. It already excludes Banger-origin rows
(`bangerOriginNoRealThesis`), but had **no guard on `deadPlayReason(play)`** — the exact predicate
`entryTriggerDeadReason` (a few lines above, same function/file) already uses to decide whether to
append "this level no longer fires the setup" to the entry-trigger line directly above it. So for a
genuinely dead WATCH play (`setupState: EXTENDED` / `entryStatus: EXTENDED_CHASE`), the section
rendered its own "no longer fires the setup" line immediately followed by a bare, unqualified
"Thesis **intact**" — directly contradicting both that neighboring line and the Verdict section's
"Extended past the valid entry window — do not chase; wait for a reset."

**Live impact:** reproduced on two independent real tickers in the same cycle:
- **UNH** (WATCH): Verdict — "Extended past the valid entry window — do not chase; wait for a
  reset."; Watch levels — "Entry trigger: **399.15** — ... extended past the valid entry window —
  this level no longer fires the setup" immediately followed by "Thesis **intact**".
- **MU** (WATCH): identical shape — "Entry trigger: **904.90** — ... extended past the valid entry
  window — this level no longer fires the setup" then bare "Thesis **intact**".

This is the same "two sections of one brief disagreeing about the same fact" bug class this
standing mandate has fixed repeatedly elsewhere in this file (`thesisHealthSection`'s
roundTrip/giveback fixes, `watchEntrySection`'s wording collision fixed 2026-10-08) — this specific
line just never got the equivalent guard, and there was no regression test covering the dead-WATCH
case (only the existing Banger-origin and CLOSED-bucket suppressions had tests).

**Fix:** added `deadPlayReason(play) == null` (already imported in this file, from
`entry-enterability.ts`) to the existing condition, scoped to `deadPlayReason`'s 4 genuinely-dead
cases only — not the broader `gateFramingMootReason` (which also covers FORMING/below-floor plays
that are still live and could reasonably still have an "intact" thesis; a milder variant of this
pattern on a FORMING/legacy-pinned-stale candidate (EWY) was also observed but is NOT acted on here
— lower confidence, flagged for a human glance rather than fixed, since that case isn't genuinely
dead and the two claims there are about technically different things).

**Test:** `src/lib/swing/play-brief-intel.test.ts` — new regression test alongside the existing
Banger-origin/NATIVE/CLOSED `watchForSection` thesis-line tests, using the same
`entryStatus: "EXTENDED_CHASE"` fixture shape this file's own prior dead-play tests already
establish. RED→GREEN proven via `git stash` on the production file alone (test fails without the
guard, passes with it); full `play-brief-intel.test.ts` suite (272 tests) still green.

## Lane-rank's "exiting peer" exclusion set omitted STOP_OUT — a position that just hit its hard stop could still be named "Desk leader" — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo × Night Hawk Swings standing mandate, Workflow static-code sweep
of not-yet-audited `play-brief-*.ts` files.

**Root cause:** `computeLaneRank` (`src/lib/swing/play-brief-lane-rank.ts`) picks a "Desk leader"
peer to name in the brief's lane-rank narrative, explicitly excluding any peer whose own manage
engine already says "get out" — the whole point being that a member reading "Leader: TICKER @
score" should never be pointed at a position the desk is actively telling members to exit (this
exact bug shipped and was fixed once already, 2026-09-12, for a CRWD EXIT_RUNNER live repro, per
the function's own comment). The exclusion set, `EXITING_MANAGE_ACTIONS`, was `new Set(["EXIT",
"EXIT_RUNNER"])` — it never included `STOP_OUT`, even though `STOP_OUT` is defined elsewhere
(`src/lib/zerodte/scale-out.ts`) as exactly the same severity of "get out" verdict: "not yet
scaled and the mark hit the −60% hard stop → exit everything." The sibling set two lines below,
`REDUCE_MANAGE_ACTIONS`, already includes `STOP_OUT` for its own (related but distinct) purpose —
`EXITING_MANAGE_ACTIONS` simply never got the same addition.

**Live impact:** a peer whose own `manageAction` is `STOP_OUT` — i.e. it just hit its hard
capital-preservation stop — passed the `leaderCandidates` filter unfiltered and could be named
"Desk leader: TICKER @ score — confirm before adding size" in a DIFFERENT play's brief, reading as
"put money here" about a position the desk is simultaneously telling members it just stopped out
of. Identical failure shape to the already-fixed CRWD/EXIT_RUNNER case, just for the one
"get out" manageAction value that set didn't cover.

**Fix:** Added `"STOP_OUT"` to `EXITING_MANAGE_ACTIONS`.

**Fix rationale:** One-line addition matching the sibling `REDUCE_MANAGE_ACTIONS` set's existing
treatment of `STOP_OUT` — no new mechanism, the exclusion logic itself was already correct and
just missing this one value in its set.

**Blast radius:** Single set, single consumer (`leaderCandidates` filter inside `computeLaneRank`).
`EXITING_MANAGE_ACTIONS` has no other reader (repo-wide grep).

**Tests:** 1 new regression test mirroring the existing EXIT_RUNNER test exactly, substituting
`STOP_OUT` as the raw #1 peer's `manageAction`. RED→GREEN proven via `git stash` (fails against
the pre-fix source — CRWD still named leader despite STOP_OUT — passes post-fix). `tsc --noEmit`
clean. Full `play-brief-lane-rank.test.ts` (36 tests) green, run on Node 20.

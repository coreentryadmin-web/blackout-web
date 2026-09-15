> **kind:** FINDING

## The "Break watch" risk headline always framed the premium stop as a future risk, even when the executable bid was already at/through it — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** A swing play is always LONG PREMIUM (a bought call for LONG, a bought put for
SHORT — see `executableFill`'s own doc comment, `terminal-ladder.ts`), so it is always SOLD into
the BID to exit — `play.execMark` (the bid) is the honest exit fill regardless of direction. The
fallback "Break watch" bullet in `tradeManagerNarrativeSection` (`play-brief-narrative.ts`) only
ever framed the premium stop as a FUTURE risk — "lose premium stop $X → cut size or exit" — even
when the bid was already AT or THROUGH that stop right now.

That fact already existed elsewhere in the brief: `watchForSection`'s "Premium stop rail" line
(`play-brief-intel.ts`) already computes `executableCushionGone` and renders "no real cushion on
the executable side (bid already at/through this level)" — a fix from an earlier session
(2026-09-12/14, same NN position). But that note sits as a footnote at the bottom of a reference
section ("What to watch"), never reaching the reserved, always-surfaced "Break watch" bullet that
IS the brief's actual risk headline — the one line safety-critical coaching is deliberately
exempted from `MAX_BULLETS` to guarantee always shows.

**Evidence (live reproduction, 2026-09-15, forensic batch 33):** NN#32 — entry $1.95, mark $1.20
(mid, -38.5%), stop rail $0.78, execMark (bid) already at/through the stop. The brief's headline/
Verdict/Trade-manager-read all said **HOLD**, and the reserved Break watch bullet said "lose
premium stop $0.78 → cut size or exit" as if the stop were still ahead — when the real, sellable
price was already past it. A member reading top-to-bottom and trusting "HOLD" could easily miss
that their real exit was already past the intended risk line.

**Blast radius:** `tradeManagerNarrativeSection`'s fallback Break watch line, both LONG and SHORT
branches (both use the same bid-based exec fill per the reasoning above).

**Fix:** when `execMark` is known and already at/through `stop_premium`, the Break watch bullet now
says "stop already breached on the executable side — bid $X.XX is at/through your premium stop
$X.XX right now → exit or cut size" instead of the forward-looking framing. The dollar stop level,
the `manageAction`/recommendation, and every gate that decides HOLD/EXIT/STOP_OUT are untouched —
this is purely a narrative-prominence fix, promoting an already-computed fact into the always-shown
headline bullet rather than changing when the system recommends exiting.

**Fix rationale:** minimal, additive change confined to the fallback-bullet construction; no gate
math changed, so no live-trading recommendation logic is at risk. Considered instead changing
`evaluateSwingManagement`'s premium-stop gate to key off `execMark` — deliberately NOT done here:
that changes *when* the system recommends STOP_OUT, a real risk-defining decision that deserves its
own scoped review rather than riding a narrative-prominence fix.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed 2 new regression tests — built
directly off the live NN#32 repro shape, one LONG one SHORT — fail against pre-fix code with the
exact production symptom, restored and confirmed both pass, alongside a third new test proving the
not-yet-breached case is unchanged). Full `play-brief-narrative.test.ts` (81 tests, +3) and
`src/lib/swing/*.test.ts` (1153 tests) green, `tsc --noEmit` clean.

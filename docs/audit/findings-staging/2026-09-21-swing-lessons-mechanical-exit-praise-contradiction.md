## Ask Largo / Swing play-brief "Lessons" section praised a giveback as "did its job" for any target/ratchet exit, regardless of how much of the peak was actually captured — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-intel.ts` (`lessonsSection`) |
| **Status** | FIXED |
| **Severity** | P3 — narrative-quality/coherence, not a data-correctness bug (every underlying number rendered was correct) |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate — live `GET /api/market/swing/play-brief` deep-dive against fresh (not previously checked) closed positions, 2026-09-21 |

### Root cause

`lessonsSection`'s `closedReason` block rendered `"Mechanical exit fired as designed — thesis or
ladder did its job."` **unconditionally** whenever `play.closedReason` was `"target"` or
`"ratchet"` — with no regard for the MFE-capture quality the same function had just computed a few
lines earlier in the identical section. A "target"/"ratchet" exit reason only means the exit
*mechanism* fired at its programmed level; it says nothing about whether that was a good outcome,
and the two can diverge sharply (a first-rung target that fires while the position later runs much
higher before the rest closes on a weak trailing exit still reports `closedReason: "target"`).

This is the exact "disconnected bullet-dump contradiction" class this same function has already
been fixed for twice before (see the `BUG FIX (2026-09-18)` comments immediately above this one in
the file, for the `round_trip` and `capture>=75` branches) — this was the one branch with **zero**
gating at all.

### Evidence

Live repro, `GET /api/market/swing/play-brief?playId=SWING:KKR:<id>` (real production data,
2026-09-21, closed KKR position): peak `+203.8%`, exit `+50.5%`, MFE capture `24.8%` — the ladder
gave back roughly three-quarters of the peak move. The SAME "Lessons" section rendered, in order:

```
MFE capture: **24.8%** of peak move
Exit: **target**
Mechanical exit fired as designed — thesis or ladder did its job.
```

("Gave back the move — next time tighten at first trim rail or thesis fade." was correctly
present in "Trade manager read" and correctly deduped out of "Lessons" by the existing
`adviceAlreadyNoted` gate — that part was working. It's the very next line, unrelated to that gate,
that contradicted it.) A member reading top-to-bottom sees a 24.8% capture called out as weak,
immediately followed by unqualified praise for the exact same exit. Same pattern independently
confirmed on RVMD/WULF/NOW briefs pulled the same session, all clean (their captures didn't land in
the weak band, so the pre-fix code happened to be correct there too — which is exactly why this
went unnoticed: it only misfires on the *specific* combination of `closedReason` in
`{target,ratchet}` **and** a weak-capture outcome, not on every target exit).

### Fix

Hoisted the already-computed `mfeCaptureOutcome()` result (previously scoped only inside the
`peak != null && exitPnlPct != null` block) to function scope, and gated the "did its job" line on
it: when the outcome is `round_trip`, or `capture` with `capturePct < 35`, the line is replaced
with an honest one that separates the two claims —
`"Exit mechanism fired correctly, but the ladder banked little of the peak — see MFE capture
above; review trim timing, not the mechanism."` A genuinely strong capture on the same
`closedReason` still gets the original "did its job" praise — the fix narrows the unqualified
claim, it does not remove it.

### Blast radius

Single call site (`lessonsSection`'s `closedReason` block). `closedCoaching`
(`play-brief-narrative-coaching.ts`, feeds "Trade manager read") has no equivalent "did its job"
line for `target`/`ratchet` at all, so there was nothing to keep in sync there. No other section
composes this claim.

### Tests

New test in `play-brief-intel.test.ts`: a weak-capture target exit (peak +203.8%, exit +50.5%,
capture 24.8% — the live KKR shape) no longer renders "did its job" and instead renders the new
honest line; a strong-capture target exit (peak +60%, exit +55%, capture 91.7%) still renders "did
its job", proving the fix narrows rather than removes the line. RED→GREEN verified via
`git stash` on the implementation file alone (test fails against the old code, passes against the
new). Full `play-brief-intel.test.ts`: 177/177 pass. `tsc --noEmit`: clean.

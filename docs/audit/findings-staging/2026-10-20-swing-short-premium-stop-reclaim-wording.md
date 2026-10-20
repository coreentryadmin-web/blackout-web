## SHORT-side premium-stop "Break watch" fallback said "reclaim", inverting the actual trigger direction — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** When `breakTrigger` finds no structural GEX level and a premium stop
(`play.exitPolicy?.stop_premium`) is known, the LONG fallback correctly says "lose premium stop $X →
cut size or exit" (premium falling to/through X is the trigger). The SHORT fallback instead said
"reclaim $X → cover shorts", implying the trigger is the premium RISING back up to X. But this
file's own established mechanic (`execBreached = execStop != null && play.execMark != null &&
play.execMark <= execStop`, a few lines above) makes clear the premium-stop floor concept is
direction-agnostic: a swing play is always LONG PREMIUM (a bought call for LONG, a bought put for
SHORT), so it is always sold into the bid to exit, and the floor is breached only by a FALL, for
both directions alike. "Reclaim" is the correct word for a structural resistance level a SHORT
thesis invalidates by reclaiming from below (`narrateFlip`/`narrateWall` correctly use it for
structural levels) — it is backwards for a premium floor.

**Live impact:** a SHORT swing position with a known premium stop not yet breached, and no
structural GEX level to cite instead, rendered "**Break watch** — reclaim **$0.50** → cover
shorts." A member reads this as needing the premium to rise back to $0.50 before covering, when the
actual risk — confirmed by this same file's `execBreached` logic a few lines above — is the premium
falling to or through $0.50, which should prompt covering, not waiting for a "reclaim."

**Fix:** Change the SHORT fallback's wording from "reclaim ... cover shorts" to "lose premium stop
... cover shorts", matching the LONG branch's verb for the identical kind of value.

**Fix rationale:** Minimal, wording-only change — no logic/trigger-condition change, since
`execBreached` (the actual breach detection) was already correct; only the forward-looking
fallback's prose was backwards.

**Blast radius:** Single branch inside `tradeManagerNarrativeSection`'s premium-stop fallback. One
pre-existing test (`play-brief-narrative.test.ts`, "SHORT break watch uses stop_premium not
target") had pinned the old, buggy "reclaim" wording as its expected output — updated to assert the
corrected wording (the test's real purpose, precise stop_premium rendering, is unaffected).

**Tests:** 1 new regression test exercising the not-yet-breached SHORT fallback directly (bid above
stop, no structural level present) — asserts "lose premium stop **$X**" and NOT "reclaim". Updated
the one pre-existing test that pinned the old wording. RED→GREEN proven via `git stash` on just the
source file (new test failed pre-fix — rendered "reclaim" — passes post-fix). Full
`play-brief-narrative.test.ts` (138 tests) green on Node 20. `tsc --noEmit` clean.

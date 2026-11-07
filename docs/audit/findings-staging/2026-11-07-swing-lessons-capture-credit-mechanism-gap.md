# Night Hawk Swings closed play-brief self-contradicts on trim mechanism (take 2, same play) — FIXED

> **kind:** FINDING

## Symptom
Live CLOSED swing play-brief for `SWING:MRNA:68` (fetched fresh, 2026-11-07 ~21:34 UTC, Ask Largo
standing mandate), re-checked immediately after merging the fix for the first instance of this
contradiction (PR #7529, same play, earlier today) — contains the SAME self-contradiction class,
now sourced from a different branch of the SAME function:

**Lessons** (`lessonsSection()`, `src/lib/swing/play-brief-intel.ts`) rendered, two lines apart, in
the same section:
- "**Strong exit discipline** — banked most of the move; replicate trim ladder timing."
- "Closed positive, but the scale-out ladder's own +100% trigger is not confirmed to have fired —
  review how this actually exited (manual close, time-stop, or thesis-break) before crediting the
  mechanism."

Same record (`closedReason: "target"`, `trimEnforcedBeforeClose: false`), same section, opposite
verdicts on whether the scale-out ladder's trim mechanism fired — one line credits "replicate trim
ladder timing", the next says that exact mechanism "is not confirmed to have fired".

## Root Cause
`lessonsSection()` has TWO independent branches that can assert a ladder/mechanism credit for the
same closed play:
1. The `outcome?.kind === "capture"` / `capture >= 75` branch (line ~2646), which pushes "**Strong
   exit discipline** — banked most of the move; replicate trim ladder timing." gated ONLY on
   `captureAlreadyNoted` — a dedup flag, not a correctness check.
2. A separate `closedReason === "target"/"ratchet"` block (line ~2720) that already carries a
   `mechanismConfirmed = play.trimEnforcedBeforeClose === true` gate, added 2026-11-01 for the
   PANW:67 finding.

`captureAlreadyNoted` (`play-brief-intel.ts`, call site) is derived by STRING-MATCHING
`narrative?.body?.includes("replicate trim timing")` against "Trade manager read"
(`closedCoaching()`, `play-brief-narrative-coaching.ts`) — i.e., branch 1 only ever avoided
crediting an unconfirmed mechanism BY ACCIDENT, because `closedCoaching`'s own capture>=75 branch
used to say "replicate trim timing" unconditionally, which made `captureAlreadyNoted` true for
every capture>=75 play and suppressed branch 1's restatement as a duplicate.

PR #7529 (earlier today, same mandate) gated `closedCoaching`'s capture>=75 branch on
`trimEnforcedBeforeClose` — correctly fixing the ORIGINAL contradiction between "Trade manager
read" and "Lessons". But that fix changed `closedCoaching`'s unconfirmed-mechanism phrasing to no
longer contain "replicate trim timing" — which made `captureAlreadyNoted` correctly go `false` for
exactly the plays PR #7529 was fixing, which in turn let `lessonsSection`'s OWN branch 1 fire its
unguarded credit — reproducing the identical contradiction class one function over, between two
SIBLING branches of the SAME function this time, rather than between two different functions.

Same failure shape CLAUDE.md already documents twice over for this codebase: one bug, two
near-identical call sites, one gets the fix — except this instance also demonstrates that a
dedup/suppression flag is not a substitute for an independent correctness gate on each branch it
happens to mask.

## Fix
Added the identical `trimEnforcedBeforeClose === true` gate to `lessonsSection()`'s own
`capture >= 75` branch (line ~2646), exactly mirroring the 2026-11-01 PANW:67 fix already present
on the sibling `closedReason`-based block in the same function. The "Strong exit discipline ...
replicate trim ladder timing" line now requires `!captureAlreadyNoted && mechanismConfirmed`. When
the mechanism isn't confirmed, this branch now renders nothing beyond the raw "MFE capture: X% of
peak move" fact, leaving the (correctly gated) closedReason-based block as the section's only word
on whether the mechanism itself fired.

## Blast Radius
- `src/lib/swing/play-brief-intel.ts` — `lessonsSection()`'s `capture >= 75` branch gated.
- `src/lib/swing/play-brief-narrative-coaching.ts` — unaffected; already correct (PR #7529, today).
- `lessonsSection()`'s own `closedReason`-based block — unaffected; already correct (2026-11-01).
- No other call site of `lessonsSection` needed changes.

## Evidence
- Live repro (post-PR-#7529, pre-this-fix): `GET /api/market/swing/play-brief` for `SWING:MRNA:68`
  — "Lessons" says "Strong exit discipline ... replicate trim ladder timing" immediately followed
  by "the scale-out ladder's own +100% trigger is not confirmed to have fired ... before crediting
  the mechanism." Same `trimEnforcedBeforeClose: false` record, same section, opposite verdicts.
- `npx tsc --noEmit` clean after the change.
- New regression test in `play-brief-intel.test.ts` pins both sides of the gate (confirmed ladder
  exit still gets credit; unconfirmed does not) — RED confirmed via `git stash` on the source file
  alone (1 fail), GREEN with it restored.
- Full `src/lib/swing/*.test.ts` suite: 2238/2238 pass (33 suites), Node 20.

## Fix rationale
Mirrored the existing `mechanismConfirmed` gate from this same function's `closedReason`-based
block rather than inventing new phrasing, since both branches must agree on the same frozen fact
(`trimEnforcedBeforeClose`) for the same play. Chose to suppress the credit line entirely when
unconfirmed, rather than add a second hedge sentence, because the closedReason-based block in the
same section already states the honest hedge — a second, differently-worded hedge would reintroduce
exactly the "disconnected bullet-dump restatement" pattern this function's own `*AlreadyNoted` dedup
flags exist to prevent. Left `closedCoaching()` and the closedReason-based block untouched; both
were already correct and are the reference this fix mirrors.

| **Status** | Fixed in PR (this commit) |

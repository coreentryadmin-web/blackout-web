## Swing `crossDeskCoaching`'s "Desk alignment" bullet never counted HELIX flow agreeing with the swing — only disagreeing — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `crossDeskCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (member-facing narrative quality / Largo product-contract disagreement-representation principle) |
| **Status** | FIXED |

### Root cause

`crossDeskCoaching` checks all FOUR desks (Night Hawk, 0DTE, Vector, HELIX) for **conflict** with
the swing's own direction — each desk that disagrees is pushed into a `conflicts` array via the
`conflict(...)` helper and, when the array is non-empty, rendered as a ranked "Cross-desk friction"
bullet (HELIX flow disagreement is weighted `2`, the second-highest of the four `CROSS_DESK_BASE_WEIGHT`
kinds, behind only Vector's live price structure).

But the function's **alignment** branch — which only runs once `conflicts.length === 0` — only ever
pushed Night Hawk and 0DTE into the `aligned` array. HELIX's own `callHeavy`/`putHeavy` read (already
computed a few lines above, and already used for the conflict check) was never checked against the
swing's direction for the *agreeing* case at all. So:

- HELIX flow **disagreeing** with the swing → surfaces as "Cross-desk friction" (weight 2 of 4).
- HELIX flow **agreeing** with the swing → surfaced nowhere in the entire brief. `flowIntelSection`
  (`play-brief-intel.ts`) renders the raw HELIX bias fact ("call-heavy"/"put-heavy"/"balanced") but
  never connects it to the swing's own direction the way `vectorPlayCoaching`/`flowPrintsCoaching` do
  for Vector's two signals — those two both have an explicit "**aligned** with swing lane." /
  "**Aligns** with swing direction." suffix; HELIX's aggregate flow had no equivalent anywhere.

This is a one-sided disclosure of exactly the shape the Largo product contract's disagreement
principle exists to prevent ("disagreement is represented, never reconciled by the lanes
themselves") — just manifesting on the corroborating side rather than the conflicting one: a member
sees when HELIX disagrees with their thesis but never sees when it corroborates it, even though
corroboration is the more actionable of the two for sizing confidence.

### Evidence

Live-read `crossDeskCoaching` (lines 589-653 pre-fix): `putHeavy`/`callHeavy` computed at
lines 606-607 and used at lines 634-635 for `conflict(...)` calls, but the `aligned` array
(lines 641-647) only ever pushed `nh`/`z` entries — no `flow`/`callHeavy`/`putHeavy` reference
anywhere in that block. Confirmed via full-file read there is no other coaching function
(`flowPrintsCoaching`, `confluenceCoaching`, `flowIntelSection`) that connects HELIX's aggregate
call/put premium read to the swing's own direction as a positive/aligned fact — `flowPrintsCoaching`
and `confluenceCoaching` both read Vector's OWN flow markers/confluence zones, a different data
source from HELIX's `trustedHelixFlow`.

### Blast radius

Contained to `crossDeskCoaching`'s alignment branch alone — the conflict branch, `vectorPlayCoaching`,
`flowPrintsCoaching`, and `flowIntelSection` are all untouched. No schema/type change: `aligned` was
already `string[]`, one more conditional push into the same array.

### Fix rationale

Mirrors the conflict branch's own `callHeavy`/`putHeavy` check, one-for-one: `LONG` + `callHeavy` or
`SHORT` + `putHeavy` now pushes `HELIX call-led`/`HELIX put-led` into `aligned`, using the identical
`call-led`/`put-led` vocabulary the conflict branch already uses for HELIX (`conflict("HELIX",
"put-led", "flow")` / `"call-led"`). The existing `aligned.length >= 2` threshold is left untouched —
a single aligned desk (including HELIX alone) still stays silent, same noise-floor discipline the
NH/0DTE-only version already had. Deliberately did NOT add Vector to this array: Vector's alignment
already has its own dedicated, more detailed line via `vectorPlayCoaching`'s "— aligned with swing
lane." suffix, so adding it here would either duplicate that fact or require the same de-dup
machinery `vectorPlayCoaching`'s `conflictAlreadyNoted` flag already handles for the conflict case —
out of scope for this fix, which only closes the HELIX gap (HELIX has no other home for this fact
anywhere in the brief).

### Tests

Three new tests in `play-brief-narrative-coaching.test.ts`:
- `crossDeskCoaching: HELIX call-heavy flow now counts toward Desk alignment on a LONG swing`
- `crossDeskCoaching: HELIX put-heavy flow now counts toward Desk alignment on a SHORT swing`
- `crossDeskCoaching: HELIX alignment alone (single desk) still stays below the two-desk threshold`
  (proves no new false positive from a lone HELIX signal)

RED→GREEN proven via `git stash` isolating the source fix from the tests: reverting only
`play-brief-narrative-coaching.ts` reproduces exactly 2 failures (the two positive-alignment tests);
restoring the fix returns to 115/115 pass in this file. `npx tsc --noEmit`: clean. Full `npm test`
(Node 20): 14882 pass / 0 fail / 3 skipped (pre-existing, unrelated skips).

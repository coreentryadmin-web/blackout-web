## riskTheOtherSide could name a kind-mismatched wall, disagreeing with resolveInvalidationFocalLevel — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief-ladder.ts`/`play-brief-diff.ts`/`play-brief-resolve.ts`, batch 17).

**Root cause:** `buildStructureLadder`'s `riskTheOtherSide` (`play-brief-ladder.ts`) picked the
nearest unfavorable-side rung whose `role !== "neutral"` — i.e. ANY of `call_wall`/`put_wall`/
`dark_pool`/`king` that happened to sit on the wrong side of spot for the thesis, with no check
tying the chosen KIND to the trade DIRECTION. `resolveInvalidationFocalLevel`
(`play-brief-narrative.ts`) — the function the brief's "Break watch" bullet and invalidation
headline route through, and which this very file's own 2026-10-20 comment on that function
explicitly cross-references as the sibling this widget must stay consistent with — is stricter:
only `put_wall`/`dark_pool`/`king` are candidates for a LONG's invalidation level (never
`call_wall`), and only `call_wall`/`dark_pool`/`king` for a SHORT's (never `put_wall`).
`collectFocalLevels` applies no side validation when building call_wall/put_wall entries, so a call
wall CAN sit below spot (e.g. after a sharp rally through it) and a put wall CAN sit above spot
(after a sharp selloff) — a reachable real data shape, not one the type system excludes. When that
happens, `riskTheOtherSide` named the nearer, kind-mismatched wall as "the nearest real structure
on the wrong side of this thesis" (the member-facing `BieStructureLadder.tsx` label) while the
narrative's Break-watch/invalidation line — built from the SAME `focal` array — named a different,
farther level as the one that actually invalidates the position. This directly contradicted this
file's own top-of-file claim that the widget "can never disagree with 'Trade manager read' about
where a wall... sits."

**Evidence:** LONG thesis, spot = 100, `call_wall = 98` (below spot), `put_wall = 80`.
`riskTheOtherSide`'s reduce picked the smaller `|distancePct|`, i.e. `call_wall@98`, while
`resolveInvalidationFocalLevel({direction:"LONG"})` only matches `put_wall`/`dark_pool`/`king`
below spot and returns `put_wall@80` — the narrative's "Break watch" bullet would read "lose
$80.00" while the Structure Ladder's `riskTheOtherSide` named $98.00 as the level that matters, in
the identical envelope. Confirmed via a 2-vote adversarial verify pass that independently re-read
both files and traced the exact triggering scenario before confirming.

**Fix:** excluded the cross-direction wall kind (`call_wall` for LONG, `put_wall` for SHORT) from
the unfavorable-side rung pool BEFORE either tier of `riskTheOtherSide`'s selection logic sees it —
both the real-wall tier and the neutral-pivot fallback tier — so a kind-mismatched wall can never
win, matching `resolveInvalidationFocalLevel`'s own kind restriction exactly. `dark_pool`/`king`
remain eligible on both sides (unchanged, matching the sibling function), and the existing
neutral-pivot fallback behavior (gamma_flip/max_pain/magnet, a deliberate design choice from the
2026-09-15 fix, unrelated to this bug) is unchanged.

**Tests:** `src/lib/swing/play-brief-ladder.test.ts` — added 3 regression tests: a LONG-direction
kind-mismatch repro (call wall nearer but ineligible, put wall farther but eligible — must pick the
put wall), the symmetric SHORT-direction repro, and a fall-through test (only an ineligible-kind
wall exists on the unfavorable side — must fall through to a neutral pivot, never pick the
ineligible wall as a last resort). All 3 fail against the pre-fix source (RED, confirmed via
`git stash` on the source file alone) and pass post-fix (GREEN); full
`play-brief-ladder.test.ts` suite 27/27 pass; `tsc --noEmit` clean.

**Blast radius:** `play-brief-ladder.ts` only — `resolveInvalidationFocalLevel` itself (the
reference sibling) was not touched, nor was any other consumer of `collectFocalLevels`/`focal`.

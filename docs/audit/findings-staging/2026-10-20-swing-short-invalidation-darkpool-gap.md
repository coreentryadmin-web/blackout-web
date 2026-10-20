## resolveInvalidationFocalLevel's SHORT predicate omitted dark_pool, breaking the Structure Ladder's documented no-disagreement guarantee — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** `resolveInvalidationFocalLevel`'s LONG branch treats `put_wall`, `dark_pool`, AND
`king` as candidate invalidation levels; the SHORT branch only treated `call_wall` and `king` —
`dark_pool` was missing. `narrateDarkPool` explicitly supports dark-pool prints acting as resistance
for SHORT theses, and `play-brief-ladder.ts`'s `riskTheOtherSide` treats `dark_pool` fully
symmetrically for both directions when picking the Structure Ladder's own focal level. This
function's own doc comment states its whole purpose is that every section quoting "the one
structural level that matters" (breakTrigger's "Break watch" bullet, `watchForSection`'s
"Structural resistance node" line, and the Structure Ladder widget) routes through here so they can
never disagree about where a wall sits — an omitted kind on only one side is exactly the asymmetry
that guarantee exists to prevent.

**Live impact:** a SHORT swing play whose nearest real structural level above spot is a dark-pool
print (not a call wall or GEX king) would have the Structure Ladder correctly name the dark-pool
print as "the nearest real structure on the wrong side of this thesis," while `breakTrigger`'s
"Break watch" bullet and `watchForSection`'s "Structural resistance node" line both skip it — either
citing a much farther call wall/king, or showing no invalidation level at all — giving a member two
different, contradicting "the one structural level that matters" claims within the same brief.

**Fix:** Add `dark_pool` to the SHORT branch's candidate kinds, matching the LONG branch.

**Fix rationale:** Minimal, single-line addition — no new mechanism, just closing the asymmetry
against the LONG branch's already-correct set.

**Blast radius:** Single function (`resolveInvalidationFocalLevel`). All three call sites
(`breakTrigger`, `watchForSection`, the Structure Ladder) automatically benefit since they all route
through this one shared selection, per its own doc comment's stated purpose.

**Tests:** 2 new regression tests directly exercising the exported function — (1) a SHORT candidate
now selects a resistance-side (above-spot) `dark_pool` level over a farther `call_wall`; (2) a SHORT
candidate still correctly ignores a support-side (below-spot) `dark_pool` level, confirming the
existing side-filter (`distancePct > 0`) still applies to the newly-added kind. RED→GREEN proven via
`git stash` on just the source file (test 1 failed pre-fix — selected `call_wall` instead — passes
post-fix). Full `play-brief-narrative.test.ts` (139 tests) green on Node 20. `tsc --noEmit` clean.

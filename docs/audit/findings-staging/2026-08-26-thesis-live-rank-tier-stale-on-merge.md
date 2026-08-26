> **kind:** `FINDING`

## `attachThesisFirstLive` could stamp rank_tier/archetype_gates from a discarded pre-merge thesis — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** In `attachThesisFirstLive` (`thesis/live-pipeline.ts`), each setup starts with
`pipeline = runThesisPipelineForSetup(s, mergedExtras)` — a SINGLE-setup thesis/archetype_gates/
rank_tier. `pipeline.thesis` is then swapped to the ticker-merged, multi-setup `merged` thesis
(when one exists), but `archetype_gates`/`rank_tier` were only recomputed against that new
`pipeline.thesis` **inside `if (nowEtMinutes != null)`**. Omitting `nowEtMinutes` left
`archetype_gates`/`rank_tier` describing the DISCARDED single-setup thesis while `s.thesis_first`
was stamped with the merged one — an internally inconsistent `ThesisPipelineResult`.

**Live impact.** None observed — both current callers (`scan.ts`'s `attachThesisFirstShadow`
call and the underlying `attachThesisFirstLive`) always supply `nowEtMinutes`. This was a latent
contract gap: `nowEtMinutes` is an optional parameter that silently produces an inconsistent
object when omitted, with no guard or comment marking the coupling — a landmine for any future
shadow-mode or test caller that omits it.

**Fix.** Moved the `archetype_gates`/`rank_tier` recomputation OUTSIDE the
`nowEtMinutes != null` conditional — it now always runs against the current (possibly
just-merged) `pipeline.thesis`. Safe because `evaluateArchetypeGates`'s `et_minutes` parameter is
already optional (`et_minutes?: number`, only gates the `pre_1000_et` WATCH note) — passing
`nowEtMinutes` through as possibly-`undefined` changes nothing for the current callers, which
always supply it.

**Regression test.** `thesis-first.test.ts`: "attachThesisFirstLive: rank_tier/archetype_gates
reflect the MERGED thesis even when nowEtMinutes is omitted" — two same-ticker setups (FLOW-only,
BREAKOUT-only, the same fixture as the existing `mergeScanPassTheses` merge test) run through
`attachThesisFirstLive` with `nowEtMinutes` omitted; asserts the stamped `archetype_gates`/
`rank_tier` match a fresh `evaluateArchetypeGates`/`resolveThesisRankTier` call against the
actual merged thesis. Confirmed failing against the pre-fix code (`archetype_gates.verdict`
came back `"BLOCK"` instead of the correct `"WATCH"`) and passing post-fix.

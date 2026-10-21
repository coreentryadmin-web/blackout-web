> **kind:** FINDING

## Swing play-brief: setup score / pillar breakdown never reached `envelope.evidence[]` — FIXED

**Root cause.** `whyThisSetupSection()` in `src/lib/swing/play-brief-intel.ts` renders `play.score`
via `synthesizedSetupLede()` (line 164: `", scoring ${Math.round(play.score)}"`, when not withheld)
and separately renders the full per-pillar breakdown via its own "Score pillars" bullet list
(line 317-322, straight from `play.factors`). Neither ever reached `evidenceFromContext()` in
`src/lib/swing/play-brief.ts` — the sole feeder of the typed, provenance-bearing
`envelope.evidence[]` array. A structured/JSON reader of the swing play-brief envelope therefore
saw no citable fact for the one number ("scoring 72") that grounds why a setup is graded a
particular way — the same "evidence[] completeness" bug class this lane has fixed four times this
week already (archetype track record, sub-lane track record, peers).

Confirmed live via direct source inspection: `grep -n "arsenal\.\|play\.score\b" src/lib/swing/play-brief.ts`
before this fix showed zero reference to `play.score` or `play.factors` in `evidenceFromContext()`.

**Evidence.** RED→GREEN proof via `git stash` on `play-brief.ts` alone (never the test file):
stashed, the new test failed (`not ok 43`, "expected a citable setup-score evidence entry"),
165/166 pass; restored, 166/166 pass. `tsc --noEmit` clean.

**Blast radius.** Single call site — `evidenceFromContext()` was the only consumer missing this
mirror; `whyThisSetupSection()`'s own rendering (the lede and the "Score pillars" bullet list) is
untouched and correct.

**Fix rationale.** Added a new, additive evidence push in `evidenceFromContext()`, inserted right
before the archetype-track-record block it's thematically closest to (score/archetype both ground
"why this setup"). Gated on `!play.scoreWithheld` — the identical gate `synthesizedSetupLede` uses
for `play.score` itself: a withheld score is a `0` FALLBACK (the pinned `feature_vector.evidence_score`
was missing at read time), never a real measured value (see `TerminalPlay.scoreWithheld`'s own doc
comment), so the fix never fabricates a score fact the lede itself would refuse to state — covered
by a dedicated negative-case regression test. The pillar breakdown is folded into the same fact as
a parenthetical (`Setup score: 72 (Rel. strength +18, Regime +12).`), capped at the same first-10
slice `whyThisSetupSection`'s own bullet list already uses, so the two surfaces can never disagree.
Provenance source `"Swing ledger"` (matching every other pinned-at-commit position fact in this
function — archetype/sub-lane track record, ticker track record, book overlap), `freshness:
"recent"` with `ctx.asOf` (score is pinned at commit, same reasoning as those sibling facts).
Nothing else was changed — this is a distinct root cause from the peers-evidence fix shipped
alongside it (PR #6480), even though both live in the same file, per the "one issue per branch/PR"
policy.

| **Status** | FIXED |
|---|---|

**Fix**: PR (branch `fix/swing-score-evidence-gap`).

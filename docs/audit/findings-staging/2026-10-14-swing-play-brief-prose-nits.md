> **kind:** FINDING

## Swing play-brief: grammar bug + raw placeholder in narrative prose — FIXED

| **Status** | FIXED |
|---|---|

**Root cause 1 — grammar.** `synthesizedSetupLede` (`play-brief-intel.ts`) hardcoded the article
`"a"` in `${signals} flagged this as a ${archetypePhrase} setup...`. `archetypePhrase` is prefixed
with `play.setupState.toLowerCase()` when present, and `setupState` includes `EXTENDED` — a
vowel-starting enum member — so an `EXTENDED` play rendered "flagged this as a extended pullback
continuation setup," a grammar bug in otherwise-polished trade-manager prose. Live repro: SWING:AMD
(WATCH, setupState EXTENDED).

**Root cause 2 — raw placeholder.** `flowIntelSection`'s 0DTE-desk line (both the condor and
non-condor branches) rendered `${z.conviction ?? "—"} conviction` — when `conviction` is null, this
prints the literal string "— conviction" inline mid-sentence instead of omitting the clause
entirely. Live repro: SWING:ASTS (CLOSED) rendered "0DTE desk: **short** · — conviction ·
**conflict** with swing direction." This is the flat-placeholder shape the contract's absence
principle (C3) and the narrative-quality bar both discourage elsewhere in this file.

**Evidence.** Both captured live via the standing Ask Largo deep-dive workflow this cycle
(`GET /api/market/swing/play-brief`).

**Blast radius.** Two independent, non-overlapping call sites in `play-brief-intel.ts`:
`synthesizedSetupLede` (grammar) and `flowIntelSection`'s 0DTE-desk lines (placeholder, both
branches). No other consumer reads either string.

**Fix.** (1) Compute the article from a vowel-sound check on `archetypePhrase`'s first letter —
sufficient here since the phrase is always assembled from a closed, known enum, not arbitrary user
text. (2) Build `convictionBit` once (empty string when `conviction` is null) and splice it into
both the condor and non-condor desk lines, dropping the clause entirely instead of printing "—".

**Tests.** `play-brief-intel.test.ts` gained 3 tests: an EXTENDED-setupState repro asserting "an
extended ... setup" (not "a extended"); a non-condor 0DTE row with null conviction asserting the
clause is fully omitted; a condor row with null conviction asserting the same. RED→GREEN proven:
`git stash` of the fix dropped exactly 3 of 232 tests (the three new ones); restoring the fix
brought all 232 back to green. `tsc --noEmit` clean on Node 20.

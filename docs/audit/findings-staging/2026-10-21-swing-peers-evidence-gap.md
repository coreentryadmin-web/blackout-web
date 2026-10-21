> **kind:** FINDING

## Swing play-brief: `arsenal.related` ("Peers") never reached `envelope.evidence[]` — FIXED

**Root cause.** `catalystsSection()` in `src/lib/swing/play-brief-intel.ts` (lines 1619-1621) renders
a real, live "Peers: ..." line straight from `arsenal.related` (Polygon's related-companies read).
`evidenceFromContext()` in `src/lib/swing/play-brief.ts` is the SOLE feeder of the typed,
provenance-bearing `envelope.evidence[]` array (confirmed repeatedly elsewhere in this file's own
history — see the archetype/sub-lane track-record fixes a few entries up in `FINDINGS.md`), and it
had exactly one reference to `arsenal.*` in the whole file (the "Next earnings" block) — zero
reference to `arsenal.related`. So a structured/JSON reader of the envelope saw fewer peer names
than the rendered markdown prose showed: the same "evidence[] completeness" bug class this lane has
now fixed four times this week (archetype track record, sub-lane track record, and now this).

Confirmed live via direct source inspection (not taken on faith from the auditing workflow):
`grep -n "arsenal.related\|Peers:" src/lib/swing/play-brief-intel.ts` hits only the prose-rendering
site; `grep -n "arsenal\." src/lib/swing/play-brief.ts` showed only the "Next earnings" block before
this fix — zero reference to `.related`.

**Evidence.** RED→GREEN proof via `git stash` on `play-brief.ts` alone (never the test file):
stashed, the new positive-case test failed (`not ok 80`, "expected peers evidence to mirror
catalystsSection's rendered peer list") while the full suite otherwise passed 166/167; restored,
167/167 pass. `tsc --noEmit` clean.

**Blast radius.** Single call site — `evidenceFromContext()` in `play-brief.ts` is the only consumer
of `arsenal.related` that needed to change; `catalystsSection()`'s own rendering is untouched and
correct, it was always the evidence mirror that was missing.

**Fix rationale.** Inserted a new, additive evidence push right after the existing "Next earnings"
block in `evidenceFromContext()`, gated on `eco?.arsenal?.related?.length` (never fabricates
evidence from an empty/null `related[]` — covered by a dedicated negative-case regression test),
truncated to the same first-6 slice `catalystsSection()` already uses so the two surfaces can never
disagree on which peers are shown. Provenance source is `"Polygon (related companies)"` (the actual
upstream), `freshness: "recent"` (matches the sibling "Next earnings" block's own freshness choice
— this data has no staleness clock of its own, same reasoning). Nothing else was changed.

| **Status** | FIXED |
|---|---|

**Fix**: PR (branch `fix/swing-peers-evidence-gap`).

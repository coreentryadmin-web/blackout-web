## `LargoAnswerMessage`'s "Deep dive" branch drops `envelope.followups` — the same shape of gap as `structureLadder`/`scenarios`/`tradeDecision` fixed earlier the same day

> **kind:** `FINDING`

### Summary
`BieAnswerEnvelope.followups` (`src/lib/bie/answer-envelope.ts`) is a real, populated field: every
rich BIE answer builder — `cortex-read.ts`, `nighthawk-edition-read.ts`, `verdict-core.ts`,
`scenario-read.ts`, swing's `play-brief.ts` (`followupsFor()`) — sets it to a short list of
*situational* follow-up questions derived from the exact answer just given (e.g.
`SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION` in `play-brief.ts`: "Should I trim more?" for a
`TAKE_PARTIAL` play, "Why is this at its stop?" for a `STOP_OUT` one — not a generic template).
`rich-narrative.ts`'s shared `buildRichEnvelope()` forwards it onto the final envelope
(`followups: input.followups`), so this reaches the wire on every rich Largo answer, the same way
`unavailableSources` does (per this repo's own earlier-fixed PR #4101).

`BieAnswer.tsx` already renders it (an "Ask next" chip row, gated on `onFollowup &&
envelope.followups?.length`). But `LargoAnswerMessage.tsx`'s "Deep dive" branch — the one actually
in front of a member on a typical non-concrete turn, taken whenever the envelope clears its own
`richEnough` bar (headline/bias present AND at least one of levels/sections/tradeDecision) — never
reads `envelope.followups` at all. It renders `<LargoDeskRead>` (which also never reads
`envelope.followups`), then `<LargoActionsBar>`, `<BieStructureLadder>`, `<BieScenarioCards>`,
`<LargoAnswerCaveats>` — none of which touch the field.

This is NOT masked by the separate `followups` *prop* `LargoAnswerMessage` also renders (via
`followupRow`, unconditionally, below the `rich` block): that prop is `msg.followups`, sourced from
`src/lib/largo-terminal.ts`'s own, entirely independent computation —
`withResolutionChips([...contextualFollowupsFromAnswer({envelope, ...}), ...generateLargoFollowups(...)], ...)`.
`contextualFollowupsFromAnswer` (`src/lib/largo/contextual-followups.ts`) reads
`envelope.levels`/`envelope.bias`/`envelope.tradeDecision` to build its OWN generic chips (e.g. "What
invalidates this bullish read?") — it never reads `envelope.followups`. So the two chip sources are
genuinely different content; the prop-based row is not a substitute for the envelope's own
situational suggestions, and on a Deep-dive turn the latter are simply never shown.

This is the same class of bug fixed three times earlier the same day in this same file/family
(`structureLadder` dropped in Deep dive — #7704; `BieSection.table` dropped — #7702/#7707;
`tradeDecision`'s integrity warning dropped in Concrete mode — #7705): a field the shared BIE
envelope contract populates reaches the wire, but one of several parallel UI rendering branches for
that same envelope never grew the code to read it, because each branch (`BieAnswer`, `LargoDeskRead`
+ the `LargoAnswerMessage` wrapper around it, `LargoConcreteAnswer`) evolved independently.

### Evidence
RED → GREEN, two new tests in `src/features/largo/components/LargoAnswerMessage.test.ts` (same
file/pattern as the existing Structure Ladder regression test added for #7704):
- Pre-fix: `renderToStaticMarkup(<LargoAnswerMessage envelope={envelope} answerMode="deep"
  onFollowup={() => {}} />)` where `envelope.followups = ["Should I trim more?", "Why exit the
  runner now?"]` — rendered HTML contains no trace of either string; the assertion
  `assert.match(html, /Should I trim more\?/)` fails with `The input did not match the regular
  expression`.
- Post-fix: the same assertion passes, additive to the unchanged Structure Ladder output (that
  sibling test, added for #7704, still passes unmodified).
- A second test confirms the chip row correctly renders nothing when `onFollowup` is not supplied
  (no dead click target with no handler) — unaffected by the bug, included as a control.

2/2 new tests pass post-fix, 1/2 fails pre-fix (confirmed by `git stash` of only the two source
files, re-running the suite, then restoring). Also ran the full existing `BieAnswer.test.ts` (both
of its own tests, including the just-landed "table is NOT compact" test from this same day's
earlier PR) to confirm the refactor below is behavior-neutral there: 2/2 pass. Full
`src/features/largo/answer/*.test.ts` + `src/features/largo/components/*.test.ts`: 138/138 pass.
`npx tsc --noEmit` clean (Node 20.20.2, via `/opt/nvm/versions/node/v20.20.2/bin`).

### Fix
Additive only, no existing behavior changed:
1. Extracted the "Ask next" chip row out of `BieAnswer.tsx` into a new, small reusable component,
   `BieFollowupChips.tsx` (`src/features/largo/answer/`) — identical markup/classNames/guard
   (`onFollowup && followups?.length`), just given a name so a second call site doesn't have to
   duplicate the JSX. `BieAnswer.tsx` now calls it in place of its own inline block.
2. `LargoAnswerMessage.tsx`'s Deep-dive branch now also renders `<BieFollowupChips
   followups={envelope.followups} onFollowup={onFollowup} />`, in the same spot (alongside
   `BieStructureLadder`/`BieScenarioCards`) the sibling fixes earlier the same day added their own
   missing fields.

Why a shared component rather than inlining the JSX twice: the next renderer that needs this (and
there is precedent today of a third parallel renderer, `LargoConcreteAnswer`, existing alongside
these two) should import one component, not copy markup a third time.

### Blast radius
Every rich Largo answer whose envelope carries `followups` AND clears the Deep-dive `richEnough`
bar is affected — in practice, any answer built through `buildRichEnvelope()` with a non-empty
`followups` array, which today means: Cortex reads, Night Hawk edition reads, scenario/verdict
reads, and swing play-briefs (`play-brief.ts`'s `followupsFor()`, the most situationally-specific of
the set — it varies by `play.manageAction`/`statusBucket`, not just by desk). The fix is scoped to
the two rendering files named above; no server-side envelope-building code was touched, and the
other three already-fixed fields (`structureLadder`, `scenarios`, `BieSection.table`) are untouched
and still render exactly as those PRs left them.

### Why this wasn't caught earlier
Same root cause as the three sibling fixes landed earlier the same day: three largely-independent
rendering branches (`BieAnswer`, `LargoDeskRead`+wrapper, `LargoConcreteAnswer`) consume the same
envelope contract, and a field reaching the contract has no structural guarantee of reaching every
branch that renders it — each branch's own test suite (where one exists) only ever asserted what
that branch already rendered, never cross-checked against the full envelope type's field list. This
PR does not add that cross-check either (out of scope here); the fix closes this one instance,
matching the discipline of the three PRs immediately before it today.

| **Status** | FIXED — this PR. |

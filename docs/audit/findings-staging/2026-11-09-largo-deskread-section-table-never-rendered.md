## `LargoDeskRead`'s section render block drops `BieSection.table` — the MORE commonly used of the two "Deep dive" renderers, the sibling #7702 didn't touch

> **kind:** `FINDING`

### Summary
Earlier the same day, #7702 fixed `BieSectionCard.tsx` (`src/features/largo/answer/
BieSectionCard.tsx`) to render `BieSection.table` — the structured win-rate/Wilson-LB/edge table
swing's `archetypeTrackRecordSection`/`tickerTrackRecordSection` (`src/lib/swing/
play-brief-intel.ts`) attach alongside their prose. That PR's own write-up called
`BieSectionCard` "the ONLY component that renders a `BieSection` in the member-facing 'Deep dive'
chat UI." It is not — `LargoDeskRead.tsx` renders `BieSection`s too, and it is the renderer
`LargoAnswerMessage.tsx` actually picks for a "Deep dive" (non-concrete) turn whenever the
envelope is `richEnough` (headline/bias present AND at least one of
levels/sections/tradeDecision). Because every contract-conforming chat answer carries at least
one section (`Verdict`/`Bottom line` is required before `parseAnswerEnvelope` returns at all,
and both are themselves members of `ANSWER_SECTIONS`), `sections.length >= 1` whenever the
envelope exists — so `richEnough` is true essentially always, and `LargoDeskRead` is the renderer
actually in front of a member on a typical Deep-dive turn, not the `BieAnswer`/`BieSectionCard`
path (which is reached only on the rarer non-rich-enough fallback, or when `SwingLargoInsightsPanel.tsx`
calls `BieAnswer` directly for the Command Deck brief panel).

`LargoDeskRead.tsx`'s `sections` render block (the `blocks.sections` entry, ~line 152) renders
ONLY `sec.body` via `renderInlineMarkdown` — it never reads `sec.table`, and for that matter never
reads `sec.evidence`, `sec.levels` or `sec.confidence` either (this fix scopes to `table` only,
matching #7702's exact scope, and leaves the other three section-level fields as a named
follow-up rather than widening this PR). A `BieSection` carrying both prose and a table — exactly
what `archetypeTrackRecordSection`/`tickerTrackRecordSection` produce — survives both
`buildRichEnvelope`'s blank-body filter (`src/lib/bie/rich-narrative.ts`, line 74: `s.body &&
s.body.trim().length > 0` — these sections always carry real prose, so this doesn't drop them)
and `proseSections`' body-truthiness filter (`src/features/largo/answer/section-policy.ts`), so it
reaches the "sections" block intact — and then silently loses its table in the renderer a member
is more likely to actually be looking at.

### Evidence
RED → GREEN, new test file `LargoDeskRead.test.ts` (no prior test existed for this component's
rendered output — the only existing test, `desk-read-markdown.test.ts`, is a source-text
assertion, not a render test):
- Pre-fix: `renderToStaticMarkup(<LargoDeskRead envelope={envelopeWithTableSection()} />)` —
  rendered HTML is `'<div class="largo-read">...<div class="largo-read-section-body">The desk has
  run this archetype <span class="largo-fmt-num">21</span> times before this play.</div></div>'`.
  The table's own header/row text (`Win rate`, `Breakout-long`, the `12W / 9L` cell) is completely
  absent — confirmed by the assertion failing with `The input did not match /Win rate/`.
- Post-fix: the same assertions (`/Win rate/`, `/Breakout-long/`, `/>12</`) pass, additive to the
  unchanged prose-body output (`/The desk has run this archetype/` still matches).
- A second test confirms nothing renders when the section carries no table (`table: undefined`) —
  no stray `bie-section-table` class leaks in.

2/2 new tests pass post-fix, 1/2 fails pre-fix (the "no table" control case is unaffected by the
bug by construction). Full `src/features/largo/answer/*.test.ts`: 104/104 pass. `npx tsc --noEmit`
clean (Node 20.20.2).

### Fix
Additive only, reusing the exact component #7702 just built for the sibling renderer:
1. Import `BieSectionTable` (`src/features/largo/answer/BieSectionTable.tsx`, added by #7702) into
   `LargoDeskRead.tsx`.
2. Render `<BieSectionTable table={sec.table} />` immediately after the existing
   `largo-read-section-body` div, inside the per-section map. Nothing else in the block changes
   shape or order.

No new CSS needed — `BieSectionTable` already carries its own `.bie-section-table-wrap`/
`.bie-section-table` rules from #7702, and this is the identical component, just mounted from a
second call site.

### Blast radius
Both `BieSection`-rendering branches now read `table` consistently. Currently only the two swing
composers populate `section.table`, and currently neither reaches the chat UI's own envelope
(`envelopeFromContract`/`parseAnswerEnvelope` in `src/lib/largo-terminal.ts` only ever builds
`{title, body}` sections from the model's own prose — it never attaches a `table`); the one
currently-reachable path for a table-bearing `BieSection` is `SwingLargoInsightsPanel.tsx`'s direct
`BieAnswer` render of the Command Deck brief panel, which goes through `BieSectionCard` (already
fixed) — this fix closes the equivalent gap in the OTHER branch before any future composer (or
future wiring of the swing play-brief into the chat envelope — `src/lib/largo/
swing-play-brief-read.ts` already notes the brief is reachable as a tool result, just not yet as a
structured chat envelope) hits it silently, and is the same "fix the sibling renderer too" shape
PRs #7704/#7705/#7702 established this same day for `structureLadder`/`tradeDecision`/`table`
respectively. No existing rendering behavior changed.

### Why this wasn't caught earlier
#7702's own write-up asserted `BieSectionCard` is "the ONLY component that renders a `BieSection`"
in the Deep-dive UI — a claim that was false at the time it was written (`LargoDeskRead.tsx`
renders sections too, in a parallel code path that doesn't call `BieSectionCard` at all), but
reads as true if you grep for `BieSectionCard`'s own call sites rather than for every place
`BieSection`/`.sections.map` is consumed. The two renderers evolved independently (`LargoDeskRead`
hand-rolls its own per-section markup for layout-ordering reasons; `BieSectionCard` is a proper
reusable component), so a field added to one's rendering contract has no structural reason to
propagate to the other — exactly the "3 parallel rendering branches, inconsistent field coverage"
class already named by this round's own standing lead (2 prior confirmed instances:
`structureLadder` missing from Deep dive in #7704, `tradeDecision` missing from Concrete mode in
#7705).

| **Status** | FIXED — this PR. |

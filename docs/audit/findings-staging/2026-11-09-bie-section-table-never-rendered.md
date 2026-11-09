## `BieSection.table` reaches the HTTP envelope but no UI component ever rendered it — swing's archetype/ticker track-record table was invisible to members in Ask Largo

> **kind:** `FINDING`

### Summary
`BieSection.table` (`BieTable`, `src/lib/bie/answer-envelope.ts`) is a deliberate, structured
field — its own doc comment says it exists "so a consumer should be able to join/cite the
underlying numbers, not just parse prose" (Largo product-contract C10, "historical context").
Two swing play-brief composers populate it: `archetypeTrackRecordSection` and
`tickerTrackRecordSection` (`src/lib/swing/play-brief-intel.ts`), each attaching a win-rate/
Wilson-LB/edge table alongside their prose. `buildRichEnvelope` (`src/lib/bie/rich-narrative.ts`)
forwards `RichSection.table` into `BieSection.table` unchanged, and `renderEnvelopeMarkdown`'s
`renderTable()` already renders it into the backward-compatible `markdown` string.

But `BieSectionCard` (`src/features/largo/answer/BieSectionCard.tsx`) — the ONLY component that
renders a `BieSection` in the member-facing "Deep dive" chat UI (`BieAnswer.tsx`, wired through
`LargoAnswerMessage.tsx`) — read `body`, `evidence`, `levels`, `confidence` and `provenance`, but
never `table`. And `envelope.markdown` (the string that *does* carry the table) is never read
anywhere under `src/features/largo` — the structured UI binds to the typed envelope fields
directly, never to the markdown fallback — so the table had no path to a member's screen at all,
structured or as text. This is the same "reaches the wire but the shared renderer never reads it"
shape as the `market_session_note` fix (`BieChips.tsx`, same day) and the
`subLaneTrackRecord`/`rung.meta` fix (`BieStructureLadder.tsx`, same week).

A second, independent gap compounds the first: `BieAnswer.tsx`'s `isCompact()` routes a
single-section envelope with no top-level evidence/levels/scenarios through a plain-prose branch
(`envelope.sections[0].body` via `LargoMessageBody`) that never invokes `BieSectionCard` at all.
`isCompact()` checked `section.evidence`/`section.levels` but not `section.table` — so even after
fixing `BieSectionCard`, a single-section answer whose only structure is a table (exactly the
shape these two composers produce when they are the sole populated section) would still have been
misclassified as "compact" and skipped the only renderer that now knows how to show it.

### Evidence
RED → GREEN, confirmed by `git stash push --include-untracked` isolating exactly the four changed
files (the new `BieSectionTable.tsx` component, `BieSectionCard.tsx`, `BieAnswer.tsx`, and the new
CSS), leaving the new test files in place:

- `BieSectionCard.test.ts`: pre-fix, a populated `section.table`'s header/row text (`"Win rate"`,
  `"Breakout-long"`, `"9L"`) is absent from the rendered HTML — only `body`/`bias` render. Post-fix
  it appears, additive to the unchanged body/bias output.
- `BieAnswer.test.ts`: pre-fix, a single-section envelope whose only section carries a `table`
  renders with class `bie-answer-compact` and the table text is absent. Post-fix it is NOT
  compact and the table renders.
- `BieSectionTable.test.ts` (new component, 4 tests): renders every header/cell of a populated
  table; renders nothing for an absent table, an explicit `null`, or a table with zero headers.

8/8 new tests pass post-fix, 3/8 failed pre-fix (the rest are either genuinely-unaffected-by-the-
bug control cases or the component-level tests, which can't fail pre-fix since the component
didn't exist). Full `src/features/largo/answer/*.test.ts`: 102/102 pass. `npx tsc --noEmit`
clean. `css-font-fallback.test.ts` (the exact guard a sibling PR's CSS addition tripped this same
week) passes clean on the new `.bie-section-table*` rules.

### Fix
Additive only, three pieces:
1. New `BieSectionTable.tsx` — a real `<table>` (not the fixed-3-column ARIA-div grid
   `BieKeyLevelsTable` uses), because `BieTable`'s column count is caller-defined (6 columns for
   the archetype track record, 3 for the ticker one); a fixed `grid-template-columns` would
   mis-align whichever shape doesn't match it.
2. `BieSectionCard.tsx` renders `<BieSectionTable table={section.table} />` alongside the existing
   body/evidence/levels/confidence/provenance rendering — nothing existing changed.
3. `BieAnswer.tsx`'s `isCompact()` gains `!env.sections[0]?.table`, matching the existing
   `evidence`/`levels` checks right next to it — a section with a table has structure to show, so
   it is not compact.

New CSS (`.bie-section-table-wrap`/`.bie-section-table`) matches the existing dark-theme palette
used by `.bie-levels-grid` immediately above it in `globals.css`, with horizontal scroll on
overflow (a variable-width row, e.g. a long note, stays readable instead of being cut) rather than
the fixed grid the key-levels table uses.

### Blast radius
`BieSectionCard` is the sole `BieSection` renderer, used by `BieAnswer.tsx` in both its compact and
expanded branches — every rich deterministic composer that routes through `buildRichEnvelope`
benefits automatically (currently two call sites populate `table`: the archetype and ticker
track-record sections), not just swing. No existing rendering branch changed shape; the table is a
new sibling block, never a replacement.

### Why this wasn't caught earlier
`buildRichEnvelope`'s own doc comment on `RichSection.table` already names half of this exact
trap: it says `renderEnvelopeMarkdown`/`dynamic-format.ts` "already render it" and that the
builder itself used to drop the field before the wire — a prior fix closed THAT gap, which made
`section.table` visible in the JSON response and therefore easy to assume was "done." Nobody
re-checked the other end: whether the shared chat-UI renderer, which binds to the typed structured
fields and never touches `envelope.markdown`, actually reads the field it now reliably receives.

| **Status** | FIXED — this PR. |

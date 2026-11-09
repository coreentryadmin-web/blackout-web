## `LargoConcreteAnswer` — the DEFAULT Largo chat renderer — never surfaces `envelope.unavailableSources`

> **kind:** `FINDING`

### Summary
`BieAnswerEnvelope.unavailableSources` (`src/lib/bie/answer-envelope.ts`) is documented, in the
field's own doc comment, as "Sources requested but unavailable this turn — **always surfaced**".
It is populated server-side whenever a composer's own tool-use pass failed to read a source it
asked for (a GEX-walls/dark-pool timeout, the live Benzinga 403 the repo is currently tracking,
etc.) — `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s "absence" point exists specifically so a reader
is told when part of the evidence never arrived, instead of silently getting a confident-looking
answer built on less than it claims.

Both of the other two parallel renderers for the same `BieAnswerEnvelope` already honor this:
- `BieAnswer.tsx` (the fallback renderer) renders each entry via `UnavailableChip`
  (`BieChips.tsx`), right under the header, "surfaced up top, never hidden (§4)" per its own
  in-code comment.
- `LargoDeskRead.tsx` (the "Deep dive" renderer) renders a dedicated "Could not read" section
  listing every `unavailableSources[].source`.

`LargoConcreteAnswer.tsx` — the **default** `answerMode` picked by `LargoAnswerMessage.tsx` for
every Largo chat turn unless a member explicitly switches to Deep-dive — read `envelope.headline`,
`envelope.asOf`, and `envelope.tradeDecision`, but never looked at `envelope.unavailableSources` at
all. For the overwhelming majority of real Largo chat answers (Concrete is the default, same fact
already established and fixed once for `tradeDecision` in this exact file, see the in-code comment
above `integrityNotes`), a failed/missing upstream source was dropped on the floor with zero
indication to the member that it happened.

This is the same class of bug already fixed several times this same week in this exact
renderer-family (`structureLadder`, `BieSection.table`, `tradeDecision`'s integrity warning,
`followups` — each a field that reaches the shared envelope contract but was missing from one of
the three parallel rendering branches): three independently-evolved renderers consuming one
contract, with no structural guarantee that every field lands in every branch.

### Evidence
RED → GREEN, two new tests added to a new file,
`src/features/largo/answer/LargoConcreteAnswer.test.ts` (no test file previously existed for this
component):
- Pre-fix (`git stash` of only the source change, test file left in place): rendering
  `<LargoConcreteAnswer envelope={envelopeWithUnavailableSources} content=... />` produces HTML
  with no trace of the unavailable-source text — `assert.match(html, /Unavailable/)` fails with
  `The input did not match the regular expression`. Confirmed live:
  ```
  not ok 1 - LargoConcreteAnswer surfaces unavailableSources
  ```
- Post-fix (fix restored via `git stash pop`): both tests pass —
  ```
  ok 1 - LargoConcreteAnswer surfaces unavailableSources
  ok 2 - LargoConcreteAnswer renders nothing extra when unavailableSources is absent
  ```
- `npx tsc --noEmit` clean (Node 20.20.2).
- Sanity re-ran the two sibling renderers' own existing suites (`BieAnswer.test.ts`,
  `LargoDeskRead.test.ts`) unmodified — both still pass, confirming the fix is additive and did not
  touch shared code paths.

### Fix
Additive only, mirrors `BieAnswer.tsx`'s own existing pattern exactly rather than inventing a new
one:
1. `LargoConcreteAnswer.tsx` now imports the existing `UnavailableChip` from `./BieChips` (already
   the shared component both other renderers rely on for this — no new component needed).
2. Renders one chip per `envelope.unavailableSources` entry (`${source}: ${reason}`), placed right
   after the existing `tradeDecision` integrity-notes block and before the answer body — the same
   relative position `BieAnswer.tsx` uses (surfaced near the top, before the prose).
3. Added `.largo-concrete-unavailable` to `globals.css`, a byte-for-byte copy of the existing
   `.bie-answer-unavailable` flex-wrap layout rule, so the chips wrap correctly in the narrower
   Concrete-mode layout.

Why reuse `UnavailableChip` rather than a bespoke element (as `LargoDeskRead.tsx`'s plain-text
"Could not read" section does): `BieAnswer.tsx` is the renderer with the fewest other differences
from Concrete's own layout (both are flat, no section cards), so matching its chip markup keeps the
two consistent, and it's zero new code — the component already exists for exactly this field on
exactly this envelope type.

### Blast radius
Every Largo chat turn in the default Concrete mode whose envelope carries a non-empty
`unavailableSources` — i.e. any turn where a `buildRichEnvelope()`-based composer's tool-use pass
hit a real upstream failure (GEX-walls/dark-pool timeout, the currently-tracked Polygon/Benzinga
entitlement loss noted elsewhere in this repo's own CLAUDE.md, a UW rate-limit drop, etc.) while
most members never switch out of the default mode to see it. No server-side envelope-building code
was touched; only the Concrete renderer and its stylesheet. `LargoDeskRead.tsx` and `BieAnswer.tsx`
are unmodified and continue rendering exactly as before.

### Why this wasn't caught earlier
No test file previously existed for `LargoConcreteAnswer.tsx` at all, so there was no regression
coverage of its field coverage to begin with — unlike `LargoDeskRead.tsx`/`BieAnswer.tsx`, which
already had tests (several added this same week for the sibling bugs in this family) that would
have caught a similar gap. This PR adds that coverage alongside the fix.

| **Status** | FIXED — this PR. |

## `LargoConcreteAnswer` — the DEFAULT Largo chat renderer — never surfaces `envelope.gexShifts`

> **kind:** `FINDING`

### Summary
`BieAnswerEnvelope.gexShifts` (`src/lib/bie/answer-envelope.ts`) is lifted **structurally** off the
turn's own `get_gex_matrix_changes` tool result (`gex-shift-extract.ts`) — never parsed back out of
the model's prose. It is only populated when that tool was actually called this turn, so a non-empty
`gexShifts` represents a real, already-fetched strike-level GEX-change table the member paid for the
tool round-trip to get.

Both of the other two parallel renderers for the same `BieAnswerEnvelope` already surface it, via
the shared `BieGexShiftsPanel` component:
- `LargoDeskRead.tsx` (the "Deep dive" renderer) renders `envelope.gexShifts` as a "GEX shift" block
  (`vis` aside — this one was never gated behind `richEnough`, it is read unconditionally).
- `BieAnswer.tsx` (the not-rich-enough / no-envelope fallback renderer) was fixed to render it via
  `<BieGexShiftsPanel shifts={envelope.gexShifts} />` earlier the same day (see that file's own
  in-code "BUG FIX (Ask Largo standing mandate, 2026-11-09)" comment, landed as PR #7717) — its own
  header explains the gap existed because `LargoAnswerMessage`'s `richEnough` gate only checks
  `headline`/`bias`/`levels`/`sections`/`tradeDecision`, none of which `gexShifts` affects.

`LargoConcreteAnswer.tsx` — the **default** `answerMode` picked by `LargoAnswerMessage.tsx` for
every Largo chat turn unless a member explicitly switches to Deep-dive — was the one remaining
renderer in this family that never read `envelope.gexShifts` at all. A turn that called
`get_gex_matrix_changes` but wrote no canonical section/level text referencing it (plausible: the
tool result and the prose are extracted independently per `answer-contract.ts`) silently dropped
that real, already-computed strike-level GEX-change table for the overwhelming majority of real
Largo chat answers — the member paid for the tool call and never saw its structured output.

This is the same class of bug fixed several times already this same week in this exact
renderer-family (`unavailableSources`, `tradeDecision`'s integrity warning, `structureLadder`,
`BieSection.table`, `followups`, desk-action buttons — each a field that reaches the shared envelope
contract but was missing from one of the three parallel rendering branches): three
independently-evolved renderers consuming one contract, with no structural guarantee that every
field lands in every branch. `envelope.systemReads` has the identical shape and is still open —
`LargoConcreteAnswer.tsx` does not read it either, left for a follow-up pass since this PR is scoped
to one field.

### Evidence
RED → GREEN, two new tests added to the existing `src/features/largo/answer/LargoConcreteAnswer.test.ts`:
- Pre-fix (`git stash` of only the source change, test file left in place):
  ```
  not ok 3 - LargoConcreteAnswer surfaces gexShifts
    error: |-
      The input did not match the regular expression /GEX shift/. Input:
      '<article class="largo-concrete-answer">...<p class="largo-concrete-verdict">...</p>
      <div class="largo-message-body largo-concrete-body ...">...</div></article>'
  ```
  — confirming the strike/change/direction table never rendered at all.
- Post-fix (`git stash pop`): all 4 tests in the file pass, including the pre-existing
  `unavailableSources` pair (untouched):
  ```
  ok 1 - LargoConcreteAnswer surfaces unavailableSources
  ok 2 - LargoConcreteAnswer renders nothing extra when unavailableSources is absent
  ok 3 - LargoConcreteAnswer surfaces gexShifts
  ok 4 - LargoConcreteAnswer renders nothing extra when gexShifts is absent
  ```
- `npx tsc --noEmit` clean (Node 20.20.2).

### Fix
Additive only, mirrors `BieAnswer.tsx`'s own just-landed fix exactly rather than inventing new
markup:
1. `LargoConcreteAnswer.tsx` now imports the existing `BieGexShiftsPanel` (already the shared
   component both `LargoDeskRead.tsx`'s own hand-rolled block and `BieAnswer.tsx` rely on for this
   field — no new component needed, renders nothing when `shifts` is empty/undefined).
2. Renders `<BieGexShiftsPanel shifts={gexShifts} />` right after the `unavailableSources` chips and
   before the answer body — i.e. structured, pre-computed signal strips stay grouped together ahead
   of the free-form prose, same relative ordering `BieAnswer.tsx` uses for its own evidence/levels
   panels.

Why reuse `BieGexShiftsPanel` rather than duplicate `LargoDeskRead.tsx`'s own inline JSX for the
block: it is already the shared, tested component for this exact field+shape, it renders nothing
when there is nothing to show (matching Concrete's "no card chrome unless there's something to add"
design intent), and it is the same choice `BieAnswer.tsx`'s own fix made hours earlier for the
identical gap — keeping the three renderers converging on one shared primitive per field rather than
diverging further.

### Blast radius
Every Largo chat turn in the default Concrete mode whose envelope carries a non-empty `gexShifts` —
i.e. any turn where `get_gex_matrix_changes` was actually called and returned data — while most
members never switch out of the default mode to see it. No server-side envelope-building code was
touched; only the Concrete renderer. `LargoDeskRead.tsx` and `BieAnswer.tsx` are unmodified and
continue rendering exactly as before. `envelope.systemReads` has the identical "missing from
Concrete only" gap and is explicitly left open for a follow-up (see Summary).

### Why this wasn't caught earlier
`LargoConcreteAnswer.test.ts` only gained coverage earlier the same day (for the sibling
`unavailableSources` gap) and did not yet cover `gexShifts` — so there was no regression test to
catch this field being dropped from the newest renderer in the family, even though
`BieGexShiftsPanel`'s own header already documented the identical gap existing in a sibling
renderer (`BieAnswer.tsx`) hours before this fix.

| **Status** | FIXED — this PR. |

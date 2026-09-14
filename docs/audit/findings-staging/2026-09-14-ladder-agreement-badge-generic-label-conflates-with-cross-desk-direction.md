> **kind:** FINDING

## Swing "Structure ladder" desk-agreement badge used a generic label that reads as blanket cross-desk reassurance, when it measures only dealer gamma-regime posture — FIXED

| **Status** | FIXED (PR, this commit) |
|---|---|

**Root cause:** `BieStructureLadder.tsx` rendered `ladder.crossDeskAgreement.status` as a bare
`"Desks aligned"` / `"Desks disagree"` pill in the Structure Ladder header, with no scoping text —
the "aligned" case shipped zero accompanying note at all. But the value it renders
(`crossDeskAgreementFor`, `play-brief-ladder.ts`) is deliberately narrow: it compares Vector's own
gamma-regime **posture** read (`vec.regime.posture`, long/short gamma) against what the GEX
matrix's flip vs spot independently implies — a dealer-positioning-regime comparison, not a
directional-thesis comparison. The function's own doc comment already names it precisely
("Cross-desk **gamma-regime** agreement"); only the member-facing label dropped that qualifier.

The same play-brief also ships a completely separate, dedicated system —
`crossDeskCoaching` (`play-brief-narrative-coaching.ts`) — that narrates whether Vector's
**directional call** on the ticker agrees with the swing's own thesis, using the same "cross-desk"
vocabulary. The two systems read genuinely different signals and can disagree with each other in
the same brief.

**Evidence (live reproduction, 2026-09-14 ~13:00 UTC, PLTR):** pulled the live PLTR play-brief
(`GET /api/market/swing/play-brief?playId=SWING:PLTR`) in response to a user question. The
structured `structureLadder.crossDeskAgreement` field read `{"status":"aligned"}` (dealer gamma
regime agrees), while the narrative markdown in the SAME response explicitly called Vector's
bullish PLTR call vs. this swing's SHORT thesis "the most load-bearing disagreement" — the exact
scenario this finding describes. A member looking only at the UI badge (no code access) would see
a bare "Desks aligned" pill and could reasonably read it as reassurance that both desks agree on
this trade, directly contradicting the narrative sitting right below it.

**Blast radius:** single render site — `BieStructureLadder.tsx` is the only consumer of
`StructureLadder.crossDeskAgreement` (confirmed via repo-wide grep for the field and for the old
label strings; no other component or test references the exact wording). No data-layer change —
`crossDeskAgreementFor`'s computation, the `StructureLadderAgreement` type, and its `note` text
(already correctly scoped: "the two **dealer-positioning** reads disagree on **regime**") are all
untouched and correct as-is.

**Fix:** renamed the badge label to `"Dealer regime aligned"` / `"Dealer regime differs"` and
added a native `title` tooltip on both states explicitly stating the badge does not compare
directional calls across desks and pointing to the narrative for that comparison. No logic or data
change — text/label only.

**Fix rationale:** the underlying computation and its `note` text were already correct and well
documented in code; the defect was purely that the member-facing label was more generic than what
it measures, in a product where a second, more consequential "cross-desk disagreement" concept
already exists and uses overlapping vocabulary. Renaming to `"Dealer regime"` disambiguates without
touching the (correct) underlying comparison or removing the badge's genuine value (dealer-regime
agreement is still useful information, just not the same thing as directional-call agreement).

**Test:** no test added — `src/features/largo/answer/` has zero component-render tests for any
file in the directory (confirmed via directory listing: every existing `*.test.ts` in
`src/features/largo/answer/` tests a pure logic/data module, none render a `.tsx` component), so
there is no existing harness this change fits into; `play-brief-ladder.test.ts`'s 18 tests (data
layer, untouched by this change) still pass. `tsc --noEmit` and `eslint` clean on the touched file.

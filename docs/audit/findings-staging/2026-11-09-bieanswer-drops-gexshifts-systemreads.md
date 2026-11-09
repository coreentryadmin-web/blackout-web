## `BieAnswer.tsx` — the fallback renderer for "not rich enough" / markdown-shim envelopes — never renders `envelope.gexShifts` or `envelope.systemReads`

> **kind:** `FINDING`

### Summary
`BieAnswerEnvelope.gexShifts` and `.systemReads` (`src/lib/bie/answer-envelope.ts`) are real,
independently-populated top-level fields:

- `gexShifts` is the structured strike-level GEX-change table lifted straight off the turn's own
  `get_gex_matrix_changes` tool result (`extractGexShifts`, `src/lib/largo/core/gex-shift-extract.ts`).
- `systemReads` is the cross-system consensus strip (which products independently think bullish/
  bearish/neutral about this instrument), built from tool results the turn already fetched
  (`extractSystemReads`, `src/lib/largo/core/system-reads-extract.ts`; also populated separately in
  `adaptive-response-orchestrator.ts`).

`answer-contract.ts` (line ~412-414) sets both fields on the envelope **independently** of
`sections`/`levels` — a turn can call `get_gex_matrix_changes` or consult two systems without Largo
ever writing a canonical `ANSWER_SECTIONS` heading or a level row. `LargoDeskRead.tsx` (the "Deep
dive, rich enough" renderer) already renders both as dedicated blocks ("GEX shift", "System
reads"). `BieAnswer.tsx` — the renderer `LargoAnswerMessage.tsx` falls back to whenever an envelope
does **not** clear its own `richEnough` gate (`Boolean(headline||bias) && (levels.length>0 ||
sections.length>0 || tradeDecision!=null)` — a check neither `gexShifts` nor `systemReads` factors
into at all) and the renderer used for the no-envelope markdown-shim path — never read either field.
It destructures and renders `evidence`, `levels`, `structureLadder`, `scenarios`, `invalidation`,
`unavailableSources`, and `followups` off the exact same envelope object, but had no code path for
these two.

Concretely: any answer whose envelope has a headline/bias but zero sections, zero levels, and no
`tradeDecision` — plausible any time Largo answers conversationally without writing a canonical
section heading, while the turn's tool calls still populated `gexShifts`/`systemReads` — falls to
`BieAnswer` and the member never sees the structured GEX-change table or cross-system agreement
strip at all, even though the data was fetched and is sitting on the envelope object passed
straight into the component.

### Evidence
RED → GREEN, two new tests added to the existing `src/features/largo/answer/BieAnswer.test.ts`
(extending the file #7702 already added, rather than creating a new one):
- Pre-fix: `renderToStaticMarkup(<BieAnswer envelope={envelope} />)` where `envelope.gexShifts =
  [{strike: 5800, change: -177_800_000, direction: "weaker"}]` (sections/levels both empty) —
  rendered HTML contains no trace of "GEX shift", the strike, or the direction;
  `assert.match(html, /GEX shift/)` fails with "The input did not match the regular expression".
  Same failure shape for a `systemReads` envelope and "System reads"/"Helix"/"net call flow".
- Post-fix: both assertions pass.
- A third test (included as a control, unaffected by the bug) confirms neither block renders when
  both fields are absent — no fabricated structure.
- Confirmed by reverting only the three new/changed source files (`BieAnswer.tsx`,
  `BieGexShiftsPanel.tsx`, `BieSystemReadsPanel.tsx`, `index.ts`) back to `origin/main`, re-running
  the suite (2 new tests fail, pre-existing 3 still pass), then restoring the fix (5/5 pass).
- Also ran `src/features/largo/components/LargoAnswerMessage.test.ts` (11 tests, unrelated to this
  file but exercises `BieAnswer` through the "not rich enough"/markdown-shim branches this fix
  targets) — unaffected, 11/11 pass.
- `npx tsc --noEmit` clean (Node 20.20.2).

### Fix
Additive only, no existing rendering behavior changed:
1. New `BieGexShiftsPanel.tsx` and `BieSystemReadsPanel.tsx` (`src/features/largo/answer/`) — small,
   presentational, reusing the existing `.bie-evidence`/`.bie-block-label`/`.bie-evidence-list`/
   `.bie-evidence-item` CSS classes already shipped for `BieEvidencePanel` (no new CSS needed), each
   rendering nothing when its field is absent/empty.
2. `BieAnswer.tsx` now renders both, placed alongside the other envelope-wide blocks
   (`BieStructureLadder`, `BieScenarioCards`) it already renders.
3. Both new components exported from `src/features/largo/answer/index.ts` alongside the existing
   presentational exports.

Why two small new components rather than inlining the JSX: matches the existing pattern in this
same file (`BieEvidencePanel`, `BieKeyLevelsTable`, `BieScenarioCards`, `BieStructureLadder` are all
their own files) and keeps `LargoDeskRead.tsx`'s inline version free to stay inline — that renderer
already has its own layout/ordering machinery (`answer-layout.ts`'s `blockOrder`) these fields slot
into, which a shared component would not fit cleanly. No change was made to `LargoDeskRead.tsx`,
`answer-contract.ts`, `gex-shift-extract.ts`, or `system-reads-extract.ts` — all three were already
correct; only the missing read in the sibling renderer was fixed.

### Blast radius
Every Largo answer whose envelope carries `gexShifts` and/or `systemReads` but fails the
`richEnough` gate in `LargoAnswerMessage.tsx`, and every answer on the no-envelope markdown-shim
path that later gains either field. In practice this affects any conversational Largo turn that
triggers `get_gex_matrix_changes` or consults 2+ systems without the model also writing a canonical
section/level. The admin preview (`LargoAnswerPreview.tsx`) also renders through `BieAnswer`
directly and benefits identically. `LargoDeskRead.tsx` (the richEnough branch) is untouched and
already correct — this fix closes the gap in its sibling, the same shape as the `structureLadder`/
`followups`/`BieSection.table` fixes landed earlier this week in this same file family.

### Why this wasn't caught earlier
Same root cause named in every sibling fix in this vein: `BieAnswer`, `LargoDeskRead` (+ its
`LargoAnswerMessage` wrapper), and `LargoConcreteAnswer` are three largely-independent rendering
branches for one shared envelope contract, each grown by whoever needed a field rendered in the
branch they happened to be looking at. A field reaching the contract has no structural guarantee of
reaching every branch — `BieAnswer.tsx`'s own test suite only ever asserted what it already
rendered, never cross-checked against the full envelope type's field list. This PR does not add
that cross-check either (out of scope here, same disclaimer the sibling PRs make); it closes this
one instance.

| **Status** | FIXED — this PR. |

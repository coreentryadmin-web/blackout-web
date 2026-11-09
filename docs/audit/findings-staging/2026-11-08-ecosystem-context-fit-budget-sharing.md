> **kind:** FINDING

## `get_ecosystem_context`'s `flow_full_state`/`spx_full_state`/`vector_full_state` each fit against the FULL Largo budget in isolation — combined envelope can land ~50% over the real transport cap

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/largo/ecosystem-context-fit.ts` (Largo transport fit for the `get_ecosystem_context` tool) |
| **Severity** | P2 (model-facing data loss — a real tool response can be head-sliced mid-object, silently dropping fields) |
| **Round** | 432 |

### Root cause

`fitEcosystemContextForModel` (the Largo transport fit for `get_ecosystem_context`,
`src/lib/largo/run-tool.ts:1325-1328`) caps `recent_audit_entries`/`recent_anomalies` to small
fixed counts, but its two remaining heavy fields were each fit against the **full**
`LARGO_RESULT_CHAR_BUDGET` (14,000 chars) in total isolation, with no accounting for any sibling
field:

```ts
// flow_full_state — budget hardcoded to the FULL constant, not "whatever remains":
const rowFit = fitRowsToBudget(base, "recent", raw.flow_full_state.recent, {
  budget: LARGO_RESULT_CHAR_BUDGET,
  maxRows: MAX_FLOW_PRINTS,
});
...
// spx_full_state — no budget argument at all, so fitSpxPlayForModel defaults to the same
// full LARGO_RESULT_CHAR_BUDGET:
fitted.spx_full_state = fitSpxPlayForModel(raw.spx_full_state as Record<string, unknown>).fitted
  as typeof raw.spx_full_state;
```

A THIRD heavy field, `vector_full_state`, never passes through this file's fitter at all —
`fetchEcosystemContext` (`src/lib/bie/ecosystem-context.ts:1252`) pre-fits it with
`fitVectorFullStateForModel(vectorFullState)`, also with no budget override, so it too
independently consumes up to the full 14,000-char allotment on a busy Vector rail before
`fitEcosystemContextForModel` ever sees the result.

Three sub-objects each individually "fitting" to 14,000 chars can together serialize to well over
the real 16,000-char transport cap (`MAX_TOOL_RESULT_CHARS`, `src/lib/providers/tool-result-cap.ts`).
At that point `anthropicToolLoop`'s head-slice truncation (`raw.slice(0, MAX) + "…[truncated]"`)
lands inside whichever field serializes second, discarding every key after it — silently dropping
`arsenal` (the last key in `EcosystemContext`) and leaving an unterminated JSON fragment. This is
the exact defect SHAPE already found and fixed for `get_platform_snapshot`
(`platform-snapshot-fit.ts`, #6130/#6111-pattern: "a sub-object fit against its own standalone
budget, merged with sibling fields with no shared accounting") — it had simply not yet been swept
for `get_ecosystem_context`, which has three such fields instead of one.

It also bites hardest on exactly the ticker members ask about most: `spx_full_state`/`spx_play`
populate only for SPX/SPXW, which is also where `vector_full_state`'s own bead rail is busiest
during RTH and where `flow_full_state` carries the densest tape — so the three heavy fields
collide most on `SPX`.

### Evidence (RED → GREEN)

Added a regression test building all three heavy fields together (a realistic `FlowTapeSummary`
with 120 prints, an `oversizedPlay()`-shaped `spx_full_state` copied from `spx-play-fit.test.ts`'s
own fixture, and a `vector_full_state` built the way production actually produces it — a 60-bead
rail run once through the real `fitVectorFullStateForModel`, exactly as `fetchEcosystemContext`
does before this function ever sees it).

Stashing only the code fix (keeping the new test) reproduces RED:

```
not ok 3 - fitEcosystemContextForModel: combined heavy vector_full_state + flow_full_state +
spx_full_state stays under the REAL transport cap
  error: 'fitted ecosystem context 24104 chars must fit the real 16000-char transport cap...'
# tests 3 / pass 2 / fail 1
```

24,104 chars — ~50% over the real 16,000-char cap. Restoring the fix: `# tests 3 / pass 3 / fail 0`,
final size comfortably under the cap. Full `ecosystem-context-fit.test.ts` suite (3/3),
`vector-full-state-fit.test.ts` (confirms the Vector fitter itself is untouched),
`platform-snapshot-fit.test.ts` (confirms the sibling fix this one mirrors is unaffected),
`spx-play-fit.test.ts`, `fit-tool-result.test.ts`, and `largo-fit-wiring.test.ts` all pass
(36/36 combined). `tsc --noEmit` clean project-wide. `eslint` clean on both changed files.

### Blast radius

- `src/lib/largo/ecosystem-context-fit.ts` — the only file changed.
  - `flow_full_state`'s row cap now reserves against every other field already in `fitted`
    (excluding the not-yet-fit `spx_full_state`, to avoid double-reserving against it) instead of
    the full budget in isolation.
  - `spx_full_state` is still fit LAST among the two sub-object fitters (it can still shed
    `playbook_shadow`/`desk_context`/`telemetry`/`mtf`/`option_ticket` under pressure), now against
    whatever `flow_full_state` actually left behind.
  - A new last-resort step, `degradeVectorFullStateForBudget`, trims `vector_full_state`'s row
    SAMPLES (beads/events/ladder rows/flow prints) — never its scalars, which carry the actual
    read and were already computed over the full rail server-side — if the total is still over
    budget once flow/spx are accounted for. It updates that field's OWN `fit.<section>` disclosure
    honestly in place (`returned`/`truncated`/`note` move; the `total` each section's first fit
    pass already recorded is preserved verbatim, never silently shrunk to the smaller sample).
- **Not touched, deliberately**: `src/lib/bie/ecosystem-context.ts` (the actual pre-fit call site
  for `vector_full_state`, and `spx_full_state`'s construction) is in the hard-excluded
  `src/lib/bie/*` directory — the fix is entirely at the Largo transport boundary in
  `src/lib/largo/`, same precedent `platform-snapshot-fit.ts` and `wall-dynamics-fit.ts` already
  set for reusing (never editing) fitters/helpers that live under `src/lib/bie/*`
  (`fitSpxStructureForModel`, `fitVectorFullStateForModel`). This fix additionally reuses
  `sectionScope` from `@/lib/bie/vector-fit-scope` read-only, for the identical reason.
  `fitSpxPlayForModel`/`fitRowsToBudget`/`fitVectorFullStateForModel` themselves are unmodified.

### Fix rationale

Same ordering principle `platform-snapshot-fit.ts` already established: decide the
cheaper/less-flexible fields first, fit the most-flexible sub-object fitter last against whatever
remains. Added a third step beyond that precedent because, uniquely here, even the SECOND field's
own pre-fit (`vector_full_state`, decided entirely outside this file's control) can alone consume
most of the budget on a busy rail — no reordering of the two in-file fits could fix that on its
own, so the new degrade step gives `vector_full_state` a second, budget-aware pass that only
removes row samples (whose content the field's own derived scalars already summarize, by that
module's own documented design), never scalars. An alternative — asking `fetchEcosystemContext`
to pass a smaller budget into its own `fitVectorFullStateForModel` call — was rejected: that call
site is in the hard-excluded `src/lib/bie/*` directory for this round, and even without that
constraint, re-running the full fitter a second time on an already-trimmed array would report a
smaller `total` than the real population (the second pass can only see what survived the first),
which is a worse defect (understated truncation) than the one being fixed. The in-place
section-zeroing approach here avoids that: it never re-derives `total` from a possibly-already-
trimmed array.

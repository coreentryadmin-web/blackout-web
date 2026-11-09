> **kind:** FINDING

## Largo answer-grounding "clean sweep" check falsely labeled `pass` with no independent oracle — FIXED

| **Status** | FIXED (PR, round 490) |
|---|---|

**Where:** `src/lib/correctness/largo-verifier.ts`'s `verifyLargo()` — the `shadow-recompute` /
`answer_grounding` check it emits on a clean sweep (no undisclosed low-grounding Largo answers
found in the sample).

**The bug:** the check's outcome was computed inline as

```ts
skippedNoContext > 0 && answers.length === skippedNoContext ? "consistency-only" : "pass"
```

So any run where at least one sampled Largo answer had usable `tool_results` context and none
were flagged — including the common case where **every** answer had context
(`skippedNoContext === 0`) — emitted `outcome: "pass"`.

That is the wrong outcome per this verifier family's own documented contract
(`src/lib/correctness/types.ts`'s `CheckOutcome`/`MetricStatus` doc comment: `"pass"` = "every
applicable check held **AND a second independent source confirmed it**"). Largo's numeric-
grounding engine (`auditLargoAnswerGrounding`, `src/lib/bie/verifier.ts`) checks a numeric claim
in an answer against the **same** persisted `tool_results` row that produced the answer in the
first place — a self-consistency check, not a second independent source. There is no oracle for
this metric today (the module's own header comment even says so: "Largo numeric-grounding is
SCAFFOLDED — coverage gap pending answer+tool-result logging", `run-correctness.ts`).

**Confirmed this was the only such bug in the directory.** Every other `"pass"` outcome in
`src/lib/correctness/**` pairs it with `independentlyConfirmed: true`/`ok` keyed off a REAL second
source:
- `nighthawk-verifier.ts` — live-chain strike/premium confirmation (`independentlyConfirmed:
  contradicted === 0 && confirmed > 0` / `premiumMismatch === 0`).
- `heatmap-verifier.ts` / `data-integrity-verifier.ts` / `market-context-verifier.ts` /
  `desk-verifier.ts` — the UW GEX cross-provider oracle, a 2nd Polygon index snapshot, etc., each
  with `independentlyConfirmed` set alongside `"pass"`.

`largo-verifier.ts`'s branch was the one exception — it never set `independentlyConfirmed` at all
next to its `"pass"`.

**Blast radius / why it mattered despite looking cosmetic.** `rollUpMetricStatus` (`types.ts`)
only reads each check's `independentlyConfirmed` flag (never the raw `outcome` string) when it
decides the metric's rolled-up status, so the final scorecard `MetricScore.status` for this metric
was always correctly demoted to `"consistency-only"` — the top-line scorecard was never wrong.
But `renderScorecardMarkdown` (`run-correctness.ts`) prints every individual `CheckResult`'s raw
`outcome` **verbatim** in its per-check detail list:

```
- `shadow-recompute` **answer_grounding** [pass] — 50 recent Largo answers checked — none had ...
```

So a human (or another agent) reading the markdown scorecard — the artifact this whole file exists
to produce for operator/cron consumption — saw a literal `[pass]` line claiming an independent
confirmation that never happened. That is exactly the "false green" `types.ts`'s own HONESTY
PRINCIPLE and `run-correctness.ts`'s module doc ("Consistency-only is never a false green") say
must never occur.

**Fix.** Extracted the outcome decision into a new pure helper,
`src/lib/correctness/largo-verifier-support.ts` (`largoGroundingSweepOutcome`), which:
- returns `"flag"` when any answer was flagged (unchanged behavior),
- returns `"consistency-only"` in every other case — never `"pass"`, since no second independent
  source exists for this metric today.

`largo-verifier.ts` was changed to call this helper for both branches instead of the inline
ternary. The helper has no runtime dependency on `types.ts` (only an `import type` for the
`CheckOutcome` type, which TypeScript erases — `types.ts` itself `import "server-only"`s, so a
real value import would make the helper untestable the same way `largo-verifier.ts` itself is,
per CLAUDE.md's "server-only" testing note), so it's directly unit-tested.

**Evidence (RED → GREEN).** `src/lib/correctness/largo-verifier-support.test.ts` asserts the
helper never returns `"pass"` for the previously-buggy inputs (`(0, 0, 50)` and `(0, 12, 50)`,
among others). Reproducing the original inline ternary inside the helper and re-running the suite
reproduced the bug (3/5 subtests failed, including both cases that used to return `"pass"`);
restoring the fixed body made all 5 pass. `npx tsc --noEmit` is clean.

**Fix rationale / what was deliberately left unchanged.** The message text for the clean-sweep
check was already accurate (it never claimed independent confirmation in prose) and is unchanged.
The `skippedNoContext > 0 && totalAnswers === skippedNoContext` branch's outcome
(`"consistency-only"`) was already correct and is unchanged in behavior — only the previously-wrong
`"pass"` branch was corrected. No other verifier file was touched.

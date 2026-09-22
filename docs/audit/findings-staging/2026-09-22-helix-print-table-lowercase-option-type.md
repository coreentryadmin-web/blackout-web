> **kind:** FINDING

## HELIX print-list TABLE renderer mislabeled every real PUT print as a call — FIXED

**Status:** FIXED (2026-09-22, Ask Largo standing mandate — fresh angle this cycle, checking a
non-swing desk's product-read/BIE-answer surface for once: HELIX's answer-formatting layer)

### What was broken

`helix-read-intent.ts`'s own header already documents this exact bug class and where it was fixed:
`option_type` is ALWAYS produced UPPERCASE by every real producer (`FlowAlert` is typed
`"CALL" | "PUT"`; `computeFlowStrikeStacks` normalizes to `"CALL"`/`"PUT"` too), so comparing it
against a lowercase `"put"` literal is ALWAYS false. That comment describes the fix applied to
`helix-read.ts`'s PROSE line (`optionSideSuffix`, case-insensitive, returns `"?"` rather than
guessing an unknown side) — but the sibling TABLE renderer for the exact same `helix_read` intent,
`formatHelixPrintTable` in `src/lib/bie/dynamic-format.ts`, still had the original broken
comparison:

```ts
`${p.strike ?? "—"}${p.option_type === "put" ? "p" : "c"}`
```

Reachable path: `inferAnswerShape` (`response-shape.ts`) returns `"table"` for any question
matching `wantsHelixPrintList` (e.g. "top 5 prints by premium on NVDA", "list only", "biggest
prints") — a completely ordinary member question — and `applyDynamicFormat`
(`dynamic-format.ts:353`) then dispatches `route.intent === "helix_read"` straight to
`formatHelixPrintTable`. Every row in that table compared real uppercase `"PUT"`/`"CALL"` data
against the lowercase literal, so the comparison was always false and **every print — regardless
of size or true side — rendered as a lowercase "c" (call)**. A member asking for the top prints in
table form saw every real put mislabeled a call; the same question phrased to get the prose answer
(no `wantsHelixPrintList` match) rendered correctly via `optionSideSuffix`, so the same tape read
two different, contradictory ways depending only on how the question was phrased.

### Why this matters (Largo product contract)

Per `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s direction point (C5): a wrong bearish/bullish label on
a large real print is a correctness fault, not cosmetic — a $23M PUT read as a call inverts the
implied positioning a trader would act on.

### Fix

`formatHelixPrintTable` now calls the same `optionSideSuffix` helper `helix-read.ts`'s prose path
already uses, imported from `helix-read-intent.ts` (a pure, dependency-free module built specifically
so both call sites can share one correct implementation instead of drifting). Case-insensitive,
tolerant of a bare `"C"`/`"P"`, and returns `"?"` for a genuinely unknown side rather than guessing.

### Evidence (RED → GREEN, git-stash proven)

Added `dynamic-format.test.ts`: "helix print-list TABLE renders real PUT prints as puts, not
fabricated calls" — feeds `applyDynamicFormat` a `helix_read` route + a print-list question with
one real `"PUT"` row (strike 500) and one real `"CALL"` row (strike 510).

- Stashed only the source fix (`dynamic-format.ts`), kept the new test: **1 failure** — table
  rendered `500c` (fabricated) instead of `500p`.
- Restored the fix: **3/3 pass** in the file, 0 fail.
- `npx tsc --noEmit` clean; full `npm test` run alongside this PR.

### Blast radius

One file (`dynamic-format.ts`) — the single TABLE renderer for `helix_read`. Checked every other
sibling table formatter in the same file for the identical raw-lowercase-comparison pattern
(`formatPlaySuggestTable`'s `idea.option_type === "put"` at line 38): that one is fed
`buildPlayIdea`'s output, which is strictly typed `"call" | "put"` (lowercase) and only present when
`idea` is truthy — not the same bug, left untouched. No other call site in the repo compares
`option_type` against a lowercase literal outside the already-fixed `helix-read.ts` prose line and
the swing `contract_type` family (different field, already covered by #5401/#5403 this same day).

### Not touched (deliberately)

`formatPlaySuggestTable`, `formatTechnicalsTable`, `formatWallDynamicsTable`,
`formatGridRejectionsTable`, `formatPlayEngineTable`, `formatThermalMetricTable` — none read
`option_type`, so none carry this defect.

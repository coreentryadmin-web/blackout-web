> **kind:** FINDING

## Largo answer-contract validator disagreed with its own parser about "Bottom line" satisfying Verdict — FIXED

| **Status** | Fixed (`src/lib/largo/answer-contract.ts`) |
|---|---|

**Root cause.** `ANSWER_SECTIONS` includes both `Verdict` and `Bottom line` as valid headings.
`parseAnswerEnvelope` and `fallbackAnswerEnvelope` both already treat `Bottom line` as an acceptable
substitute for `Verdict` when building the member-facing envelope (`parseAnswerEnvelope`'s
`if (!verdict) verdict = get("Bottom line")`; `fallbackAnswerEnvelope`'s
`sections.get("verdict") ?? sections.get("bottom line")`). `validateAnswerContract` — the separate
function whose whole purpose (per its own doc comment) is to make answer-contract drift
*measurable from evidence* — had no equivalent fallback: it checked only the literal `"verdict"`
heading against `REQUIRED_SECTIONS`, so any answer written with only `**Bottom line**` (a normal,
correct shape Largo is instructed to use for refusals/off-topic questions) was logged as missing
`Verdict`, even though the envelope the member actually saw was built successfully.

**Evidence.** Live CloudWatch sweep of `/ecs/blackout-production` over the last 24h (2026-10-16
15:12 → 2026-10-17 15:12 UTC) found 92 Largo turns, 82 answered, 24 `[largo] answer-contract miss`
log lines. Of those, one was the live reproduction of this exact bug:
```
[largo] answer-contract miss — missing: Verdict,Data present: Bottom line q: write my tax return
```
— an off-topic refusal correctly written with only `**Bottom line**` + `**Data**`, flagged as
missing `Verdict` by the validator alone. `fallbackAnswerEnvelope` (the function that actually
renders this shape) already promotes `Bottom line` to the headline, confirmed by test.

**Blast radius.** Single call site (`validateAnswerContract`), used only for telemetry
(`src/lib/largo-terminal.ts`'s `envelopeFromContract` logs its report but never gates on it — "a
hard gate here would mean a member watches a 60-second tool loop and then gets nothing", per that
file's own comment). No member-facing behavior changes — this fixes the measurement, not the
answer path, which was already correct via `parseAnswerEnvelope`/`fallbackAnswerEnvelope`'s existing
promotion.

**Fix.** `validateAnswerContract` now treats `sections.has("verdict") || sections.has("bottom line")`
as satisfying the `Verdict` requirement, mirroring the promotion the two envelope-builders already
apply. Regression test added: `src/lib/largo/answer-contract.test.ts` — "validateAnswerContract
accepts Bottom line as satisfying the Verdict requirement, matching parseAnswerEnvelope's own
promotion" (RED against unmodified source via `git stash`, GREEN after the fix).

**Why this matters for the Ask Largo mandate.** The same 24h sweep found a real, separate,
NOT-yet-actionable pattern worth tracking going forward: of the 14 "real" (non-empty) contract
misses, 11 were `Data` missing alone on SPX-desk reflection/comparison questions ("bull case vs
bear case for SPX into close", "where is the desk wrong on SPX if anything", "friction points in
today's SPX read", "compare thermal GEX vs desk flip on SPX", etc.) — `Data` is unconditionally
required by `REQUIRED_SECTIONS` but the model is apparently prone to omitting it specifically on
analytical/meta questions rather than concrete play questions. This fix removes the `Bottom line`
false positives from that signal so a future re-measurement of the `Data`-omission rate isn't
diluted by an unrelated validator bug; no system-prompt change is proposed yet pending a larger
sample (same evidence-before-action discipline as the other Largo/0DTE/swing A/B tools in this
repo).

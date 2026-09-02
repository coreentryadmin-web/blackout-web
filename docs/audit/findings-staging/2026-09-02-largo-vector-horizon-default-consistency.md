> **kind:** FINDING

## Several Largo-facing Vector reads silently defaulted to 0DTE-scoped walls/flip instead of the canonical all-expiry picture — FIXED

| **Status** | Fixed in this PR |

**Investigation trigger:** a QA report asked whether SPX Slayer, Thermal, and Vector derive
`call_wall`/`put_wall` from the same canonical calculation, worried that Largo could report
different wall values depending on which product it queries.

**What's NOT a bug (verified):** SPX Slayer, Thermal, and Vector's own *default* (unscoped/"all")
wall calculation all trace to the same lineage — `wallsFromStrikeTotals`/`kingFromStrikeTotals`
(`src/lib/providers/gex-cross-validation-core.ts`) and `computeGexWalls`
(`src/lib/providers/gex-wall-levels.ts`, cross-checked by its own test that
`callWalls[0]`/`putWalls[0]` match `wallsFromStrikeTotals`'s pick) — both fed by the ONE
`fetchGexHeatmap()` matrix (`src/lib/providers/polygon-options-gex.ts`, explicitly documented as
"the ONE source every other tool/service/AI surface consumes"). King node (`kingFromStrikeTotals`,
cross-side argmax `|net gamma|`) is a deliberately DIFFERENT concept from call/put wall
(per-side argmax), correctly reflected in code and docs — not a bug.

**What IS a bug (root cause, fixed here):** `fetchVectorFullState(ticker, horizon = VECTOR_DEFAULT_DTE_HORIZON)`
(`src/lib/bie/vector-full-state.ts`) defaults its `horizon` param to `"0dte"`
(`VECTOR_DEFAULT_DTE_HORIZON`, `vector-dte-horizon.ts`) — correct for Vector's own chart, which
genuinely opens on 0DTE by product design. A `"0dte"`-scoped call routes through
`getVectorGexWallsForHorizon` → `getPerExpiryGexWalls` → `vector-dte-walls-core.ts`, which
recomputes walls AND gamma flip from a **live BSM reconstruction over the raw options chain**
(volume-adjusted, today's expiries only) — a genuinely different calculation and data source than
the canonical all-expiry matrix SPX Slayer/Thermal report by default. Six call sites across the
Largo surface omitted the `horizon` argument — intending "the general/canonical Vector picture,"
not "today's 0DTE only" — and so silently inherited the 0DTE-scoped values instead:

- `src/app/api/market/largo/status/route.ts` — the Largo intelligence health strip's VECTOR row.
- `src/lib/largo/slash-prompts.ts` — the "SPX Vector read" slash-prompt preview (shows `flip` directly to the member before they even ask a question).
- `src/lib/largo/mini-panel.ts` — both the SPX desk's `vector` sub-panel (regime/spot) and the per-ticker `vector` case (spot/regime/flip/play), injected straight into a rendered Largo mini-panel.
- `src/lib/largo/desk-scope-prefetch.ts` — both the SPX desk's `vector` sub-context and the per-ticker `vector` case, which serialize the FULL `VectorFullState` (including `gexWalls`/`gammaFlip`) directly into Largo's prompt context as ground truth, right alongside the SAME file's `thermal`/`flow-gex` cases which already read the canonical matrix.

**Blast radius:** exactly these six call sites. Already-correct callers were left untouched:
`ecosystem-context.ts` and `wall-dynamics-read.ts` already pass `"all"` explicitly; `run-tool.ts`'s
`get_vector_full_state`/`get_vector_pulse` tool handlers already default to `"all"` when Largo
omits the param. Callers that legitimately want the 0DTE scope stay as-is:
`full-platform-snapshot.ts` (explicit `"0dte"`), `play-suggest-read.ts` (explicit `"0dte"`, this
IS 0DTE play suggestion), `nighthawk/cortex/fetch.ts` (explicit `"0dte"`, the Cortex 0DTE gate),
`vector-pick-sweep.ts` (explicitly imports `VECTOR_DEFAULT_DTE_HORIZON`, tracking Vector's own
default view on purpose), and `meridian-earnings-*.ts` (explicit `"weekly"`, appropriate for
earnings-week option flow).

**Fix:** made `horizon: "all"` explicit at all six sites, aligning them with the pattern already
established in `ecosystem-context.ts`/`wall-dynamics-read.ts`/`run-tool.ts`.

**Fix rationale:** did not change `fetchVectorFullState`'s own default parameter — `"0dte"` is the
correct default for Vector's own product surfaces (the chart, the pick sweep) and changing it
would silently alter behavior for callers that correctly rely on it. The bug was specifically
callers omitting the argument while intending the OTHER meaning; fixing the call sites is the
narrower, lower-risk change.

**Test:** `src/lib/largo/vector-horizon-consistency.test.ts` — source-regex-asserts every
`fetchVectorFullState(...)` call in the four affected files carries an explicit `"all"`. Verified
fails 4/4 pre-fix (`git stash`) / passes 4/4 post-fix. Existing `desk-scope-prefetch-spx.test.ts`,
`desk-scope-ticker.test.ts`, `desk-scope.test.ts`, `mini-panel-orphaned.test.ts`,
`slash-prompts.test.ts` (39 tests total) still pass. `npx tsc --noEmit`: clean.

> **kind:** FINDING

## Largo `get_wall_dynamics` live-truncated at up to ~50x the transport cap — no fitting applied at all — FIXED

| **Status** | Fixed (new `src/lib/largo/wall-dynamics-fit.ts`, wired into `src/lib/largo/run-tool.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive. A live CloudWatch sweep of
`/ecs/blackout-production` (10:45-11:40 UTC 2026-10-17) found 10 `TRUNCATED` tool results,
including the two worst of the batch:
```
get_wall_dynamics TRUNCATED 391428/16000
get_wall_dynamics TRUNCATED 792725/16000
```
— up to **~50x** the 16k transport cap, the largest overflow of any tool measured this session.

**Root cause.** `composeWallDynamicsRead` (`src/lib/bie/wall-dynamics-read.ts`) returns
`{ answer, context }` where `answer` is the real, already-concise market-facing prose summary and
`context` is supplementary raw evidence — but the Largo tool case (`run-tool.ts`'s
`get_wall_dynamics`) returned `composed` **completely unfit, with zero size handling of any kind**.
Unlike every other oversized tool in this file, this one had no fitter applied at all:
- **SPX branch**: `context: { desk, intel, ladder }` — `desk` is the same enrichment-tail-heavy
  `SpxDeskSummary` shape `fitSpxStructureForModel` exists to trim (`gex_walls`, `spx_flows`,
  `unified_tape`, `news_headlines`, `macro_events`, ...), returned raw; `ladder` duplicates
  `desk.gex_walls` verbatim with no cap of its own; `intel` (`SpxDeskBriefIntel` — `positioning`,
  `prevPositioning`, `heatmap`, `nighthawk`) has no dedicated fitter anywhere in the repo, and its
  useful content is already surfaced as prose in `answer` via `spxWallsBriefLine`.
- **non-SPX branch**: `context: state`, the full raw `fetchVectorFullState` result — bypassing
  `fitVectorFullStateForModel`, the exact fitter `vectorFullStateForLargo` (`product-reads.ts`)
  already applies for every OTHER Largo tool that reads Vector full state.

`composeWallDynamicsRead` has exactly one caller (this tool) — verified via a repo-wide grep — so
there was no competing full-data product consumer this ever needed to protect; it was simply never
fit at the Largo boundary the way every sibling tool in this file already is.

**Fix.** New `src/lib/largo/wall-dynamics-fit.ts` — `fitWallDynamicsForModel(composed)`:
- Reserves budget as `LARGO_RESULT_CHAR_BUDGET - size(answer)`, so the combined result can never
  exceed the transport cap regardless of how rich the live desk/Vector state is.
- SPX branch: fits `desk` via the existing `fitSpxStructureForModel`; omits `intel` with a NAMED
  reason (its content is already in `answer`, and no dedicated fitter exists for its own enrichment
  tail) rather than returning it raw; drops the duplicate `ladder` field.
- non-SPX branch: fits the state via the existing `fitVectorFullStateForModel`, matching what every
  other Vector-full-state-reading Largo tool already does.
- Wired into `run-tool.ts`'s `get_wall_dynamics` case.

**Tests.** New `src/lib/largo/wall-dynamics-fit.test.ts`: a sanity test proving the raw pre-fix
shape (realistic oversized desk+intel fixtures, matching `spx-structure-fit.test.ts`'s own fixture
style) exceeds the transport cap; SPX-branch and non-SPX-branch fit tests confirming the fitted
result stays under cap and omissions are named, not silent; a non-object-context passthrough test.
Full `src/lib/largo` + `src/lib/bie` suites: 2135/2135 pass.

**Remaining known-truncating tool from the same sweep, not yet fixed:** `get_etf_flow TRUNCATED
224052/16000` — not investigated this pass; natural next step for a future cycle.

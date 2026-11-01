// Fitting for get_wall_dynamics's Largo transport cap.
//
// MEASURED TRUNCATED live 2026-10-17: `get_wall_dynamics TRUNCATED 391428/16000` and
// `TRUNCATED 792725/16000` — up to ~50x the transport cap. `composeWallDynamicsRead`
// (wall-dynamics-read.ts) returns `{ answer, context }` where `answer` is the real,
// already-concise market-facing summary and `context` is supplementary raw evidence — but
// `context` was returned COMPLETELY RAW, with zero fitting applied anywhere:
//   - SPX branch: `context: { desk, intel, ladder }` — `desk` is the SAME enrichment-tail-heavy
//     `SpxDeskSummary` shape `fitSpxStructureForModel` exists to trim (gex_walls, spx_flows,
//     unified_tape, news_headlines, macro_events, ...), returned unfit; `ladder` duplicates
//     `desk.gex_walls` verbatim with no cap of its own; `intel` (`SpxDeskBriefIntel` — positioning,
//     prevPositioning, heatmap, nighthawk) has no dedicated fitter anywhere in the repo, and its
//     useful content is already surfaced as prose in `answer` via `spxWallsBriefLine`.
//   - non-SPX branch: `context: state`, the FULL raw `fetchVectorFullState` result — bypassing
//     `fitVectorFullStateForModel`, the exact fitter `vectorFullStateForLargo` already applies for
//     every OTHER Largo tool that reads Vector full state (product-reads.ts).
//
// `composeWallDynamicsRead` has exactly one caller (this tool) — there is no competing
// full-data product consumer to protect — but the fix still lives at the Largo boundary, matching
// every other fitter in this directory, in case a second caller ever wants the unfit context.
import type { BieComposed } from "@/lib/bie/composers-shared";
import { fitSpxStructureForModel } from "@/lib/largo/spx-structure-fit";
import { fitVectorFullStateForModel } from "@/lib/bie/vector-full-state-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const size = (o: unknown) => JSON.stringify(o)?.length ?? 0;

/**
 * Bound `composed.context` to what's left of the budget after `answer` — the real payload the
 * member reads — so the combined tool result can never exceed the transport cap no matter how
 * rich the live SPX desk or Vector state is.
 */
export function fitWallDynamicsForModel(composed: BieComposed): BieComposed {
  const context = composed.context;
  if (!context || typeof context !== "object") return composed;

  const remaining = Math.max(0, LARGO_RESULT_CHAR_BUDGET - size(composed.answer));
  const ctx = context as Record<string, unknown>;

  // Non-SPX branch: `context` IS the raw Vector full-state object (no `desk` key).
  if (!("desk" in ctx)) {
    return { ...composed, context: fitVectorFullStateForModel(ctx, { budget: remaining }) };
  }

  // SPX branch.
  const desk = ctx.desk as Record<string, unknown> | undefined;
  return {
    ...composed,
    context: {
      desk: desk ? fitSpxStructureForModel(desk, { budget: remaining }).fitted : desk,
      // `intel`'s useful content is already surfaced as prose in `answer` (spxWallsBriefLine); no
      // dedicated fitter exists for SpxDeskBriefIntel's own enrichment tail (positioning, heatmap),
      // so it is OMITTED here rather than returned raw and unbounded — same "named absence over
      // unnamed truncation" discipline the rest of this directory uses.
      intel_omitted:
        "SpxDeskBriefIntel omitted to fit the model's payload cap — its dealer/wall summary is already in `answer`.",
      // `ladder` duplicated `desk.gex_walls` verbatim with no cap of its own; the now-fitted
      // `desk.gex_walls` already carries this same data, so the duplicate is dropped rather than
      // fit twice.
    },
  };
}

// Fit the Vector full state under Largo's per-`tool_result` transport cap.
//
// Side-effect-free (NO `import "server-only"`) so it is unit-testable under `tsx --test`.
//
// WHY THIS EXISTS
// ---------------
// `anthropicToolLoop` caps every `tool_result` at `MAX_TOOL_RESULT_CHARS` (16,000) and enforces it
// with `raw.slice(0, MAX) + "…[truncated]"` — a HEAD slice, so **key order decides what survives**.
// `vectorFullStateForLargo` returned `fetchVectorFullState`'s object verbatim, and that object
// carries the ENTIRE in-process bead rail: `getVectorWallHistory` returns every sample, Vector
// records `VECTOR_WALL_NODES_PER_SIDE = 20` levels per side on BOTH lenses with a `notional` on
// each, so one oracle bead serializes to ~4,077 chars — a quarter of the whole budget.
//
// Measured offline 2026-08-22 against `VECTOR_FULL_STATE_FIXTURE` with realistic synthetic rails:
//
//      12 beads (1 min @5s)                          52,586 chars     3.3x cap   model gets 30.4%
//      60 beads (5 min)                             248,330 chars    15.5x        6.4%
//     360 beads (30 min)                          1,471,730 chars      92x        1.1%
//   3,720 beads (SPX's real post-compaction shape) 15,173,810 chars   948x        0.11%
//   5,760 beads (MAX_HISTORY)                      23,492,930 chars 1,468x        0.07%
//
// i.e. the payload leaves the budget after roughly FOUR beads — about twenty seconds of oracle
// rail — and during RTH the model was receiving a fraction of one percent of it.
//
// WHAT WAS LOST MATTERS MORE THAN HOW MUCH. `wallHistory` sits near the end of the key order, and
// `withReadContext` spreads `...state` FIRST and appends its blocks after it. So the cut landed
// inside the rail and discarded, in order: `wallEvents`, `vexWalls`, `vexFlip`, `darkPoolLevels`,
// `unavailable_sections`, `wall_history_empty_reason`, `observed_at`, `observed_session_date`,
// `as_of`, `session_date`, `age_seconds`, `freshness`, `note`.
//
// **Every disclosure this product built so the model is never misled is appended last, and was
// therefore the first thing the transport ate.** The model got spot, walls, flip, magnet and a
// plausible desk read with no absence report and no freshness block — the "confident answer built
// on nothing" shape those blocks exist to prevent.
//
// SAME DEFECT CLASS as `get_zerodte_record` (#2433, 1.5% delivered), `get_nighthawk_edition`
// (#2436) and `get_nighthawk_outcomes` (#2480 / #2628, a 40% win rate quoted over "5 plays" for a
// window whose real record was 74 resolved at 50%). The pattern to recognize: **a model-facing
// tool that returns a raw product object gets its key order from whatever the UI or API consumer
// needed, never from what the model needs.** `fit-tool-result.ts` is the shared remedy; this
// module applies it to Vector's shape.
//
// WHY THE FIT IS AT THE TOOL BOUNDARY AND NOT IN THE COMPOSER
// -----------------------------------------------------------
// `computeVectorFullState` must keep producing the FULL state: `buildPulseSignalsForState` diffs
// the whole rail to detect pulse signals, `scoreTopWalls` reads it for the persistence factor, and
// `eventsFromWallHistory` derives the narration from all of it. Trimming there would silently
// change what those derivations see. So the full state stays full and only the MODEL-FACING view
// is fitted — which is also what makes this module's central claim true: the events, the integrity
// score and the play were computed over the whole rail, not over the sample the model receives.

import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
// Shared with `vector-analytics-fit.ts` — one scope-note convention across both Vector tools.
import { sectionScope, type VectorSectionScope } from "@/lib/bie/vector-fit-scope";

/**
 * The sentence that stops a sample being read as the universe.
 *
 * Says explicitly that the DERIVED fields were computed over the full set, because in this payload
 * they genuinely were (see the boundary note above). A reader that quotes the derived summary is
 * right; a reader that counts the rows it can see is wrong.
 */
const AGGREGATE_HINT =
  "Every derived field above (wall events, wall integrity, magnet, proximity, the play) was " +
  "computed server-side over the FULL set, not over this sample — cite those, never a count of " +
  "the rows visible here.";

/**
 * Second, independent ceilings — bytes are not the only limiter.
 *
 * A budget alone would let a quiet tape put hundreds of near-identical beads in front of the
 * model, which is a READING problem rather than a size one: nobody asked "list every bead", and a
 * long list crowds out the walls and the regime in the model's attention even when it fits.
 * Deliberately small — `wallEvents` and `wallIntegrity` are the rail's information-dense
 * summaries and are what a reader should actually cite.
 */
export const VECTOR_FIT_MAX_BEADS = 24;
export const VECTOR_FIT_MAX_EVENTS = 24;
export const VECTOR_FIT_MAX_LADDER_ROWS = 40;
export const VECTOR_FIT_MAX_FLOW_PRINTS = 20;

type UnknownRecord = Record<string, unknown>;
type Timed = { time?: unknown };
type LadderRow = { strike?: unknown; isKing?: unknown };

/** Re-exported so existing importers of this module keep resolving it. */
export type { VectorSectionScope };

export type VectorFullStateFitScopes = {
  wall_history: VectorSectionScope;
  wall_events: VectorSectionScope;
  ladder_rows: VectorSectionScope;
  flow_prints: VectorSectionScope;
};

export type FitVectorFullStateOptions = {
  budget?: number;
  maxBeads?: number;
  maxEvents?: number;
  maxLadderRows?: number;
  maxFlowPrints?: number;
};

/** Numeric or null — a ladder `spot` and a bead `time` are both untrusted at this boundary. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Order ladder rows so the ones the model must not lose come first.
 *
 * King strikes ALWAYS lead, whatever the budget does: `isKing` marks the strongest strike on its
 * own side, so those two rows are the ladder's headline. Dropping a king while keeping forty
 * ordinary strikes would be "absence published as measurement" in miniature — the model would
 * rank whatever survived as the strongest wall. Everything after them is ordered nearest-to-spot,
 * the same preference `buildGexLadder` already applies when its own `maxRows` bites.
 */
function ladderRowsByImportance(rows: readonly LadderRow[], spot: number | null): LadderRow[] {
  const kings = rows.filter((r) => r.isKing === true);
  const rest = rows.filter((r) => r.isKing !== true);
  if (spot == null) return [...kings, ...rest];
  const distance = (r: LadderRow) => {
    const s = num(r.strike);
    return s == null ? Number.POSITIVE_INFINITY : Math.abs(s - spot);
  };
  return [...kings, ...[...rest].sort((a, b) => distance(a) - distance(b))];
}

/** Restore the ladder's documented order: rows DESCENDING by strike (highest on top). */
function byStrikeDesc(rows: readonly LadderRow[]): LadderRow[] {
  return [...rows].sort((a, b) => (num(b.strike) ?? 0) - (num(a.strike) ?? 0));
}

/** Restore a time series' documented order: ASCENDING by time. */
function byTimeAsc<T extends Timed>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (num(a.time) ?? 0) - (num(b.time) ?? 0));
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
}

/**
 * Return the model-facing view of a Vector full state, guaranteed to fit `budget`.
 *
 * The state's scalars — and critically every absence and freshness field — are carried verbatim
 * and placed BEFORE the trimmable sections, so if the transport ever cuts anyway (a caller wraps
 * or annotates the object afterwards) it eats a bead sample rather than the disclosure.
 *
 * Sections are filled in descending order of information per byte:
 *   1. `wallEvents`         — the rail's narration; a fraction of the bytes, most of the meaning.
 *   2. `ladder.rows`        — dealer structure, king strikes force-retained.
 *   3. `flowMarkers.prints` — per-print evidence.
 *   4. `wallHistory`        — the raw beads, whose content the first three already summarize.
 *
 * Each is measured against the WHOLE assembled object (`fitRowsToBudget`), never by summing row
 * sizes, so the envelope, the keys and the commas all count against the same budget the transport
 * measures. The LAST fit sees all four sections, so it is the binding one.
 *
 * Accepts a loosely-typed record rather than `VectorFullState` on purpose: this runs at a boundary
 * that also has to survive a cache entry written under an older shape.
 */
export function fitVectorFullStateForModel<T extends UnknownRecord>(
  state: T,
  opts: FitVectorFullStateOptions = {}
): T & { fit: VectorFullStateFitScopes } {
  const {
    budget = LARGO_RESULT_CHAR_BUDGET,
    maxBeads = VECTOR_FIT_MAX_BEADS,
    maxEvents = VECTOR_FIT_MAX_EVENTS,
    maxLadderRows = VECTOR_FIT_MAX_LADDER_ROWS,
    maxFlowPrints = VECTOR_FIT_MAX_FLOW_PRINTS,
  } = opts;

  const { wallHistory, wallEvents, ladder, flowMarkers, ...rest } = state;

  const beads = asArray(wallHistory) as Timed[];
  const events = asArray(wallEvents) as Timed[];
  const ladderObj = asRecord(ladder);
  const ladderRows = asArray(ladderObj?.rows) as LadderRow[];
  const flowObj = asRecord(flowMarkers);
  const prints = asArray(flowObj?.prints);

  // Newest-first for the two time series: when the budget bites, recency is what a desk read
  // needs. Both are re-sorted back into their documented order before they are returned.
  const eventsNewestFirst = [...events].reverse();
  const beadsNewestFirst = [...beads].reverse();
  const ladderByImportance = ladderRowsByImportance(ladderRows, num(ladderObj?.spot));

  // WORST-CASE wording is measured, not the final wording. The note's length depends on how many
  // rows fit, which depends on the note's length — circular. Measuring the truncated (longest)
  // phrasing breaks it in the safe direction: if a section turns out to fit whole, its real note
  // is SHORTER than what was budgeted for.
  const worstCase = (total: number, noun: string): VectorSectionScope =>
    sectionScope(total > 0 ? total - 1 : 0, total, noun, "Most recent, ascending by time", AGGREGATE_HINT);

  // The wrapper objects go into the base with EMPTY row arrays so their own scalars (`ladder.spot`,
  // `ladder.maxAbs`, `flowMarkers.meta` …) are counted. The rows themselves are fitted through
  // temporary TOP-LEVEL keys because `fitRowsToBudget` measures a top-level key; those temp keys
  // cost ~15 chars each that the returned object does not, so every measurement here is a slight
  // OVER-estimate — again the safe direction.
  const base: UnknownRecord = {
    ...rest,
    flowMarkers: flowObj ? { ...flowObj, prints: [] } : (flowMarkers ?? null),
    ladder: ladderObj ? { ...ladderObj, rows: [] } : (ladder ?? null),
    fit: {
      wall_events: worstCase(events.length, "wall events"),
      ladder_rows: worstCase(ladderRows.length, "ladder strikes"),
      flow_prints: worstCase(prints.length, "flow prints"),
      wall_history: worstCase(beads.length, "bead samples"),
    },
  };

  const fitEvents = fitRowsToBudget({ ...base }, "_events", eventsNewestFirst, {
    budget,
    maxRows: maxEvents,
  });
  const fitLadder = fitRowsToBudget({ ...base, _events: fitEvents.kept }, "_ladder", ladderByImportance, {
    budget,
    maxRows: maxLadderRows,
  });
  const fitPrints = fitRowsToBudget(
    { ...base, _events: fitEvents.kept, _ladder: fitLadder.kept },
    "_prints",
    prints,
    { budget, maxRows: maxFlowPrints }
  );
  const fitBeads = fitRowsToBudget(
    { ...base, _events: fitEvents.kept, _ladder: fitLadder.kept, _prints: fitPrints.kept },
    "_beads",
    beadsNewestFirst,
    { budget, maxRows: maxBeads }
  );

  const scopes: VectorFullStateFitScopes = {
    wall_events: sectionScope(
      fitEvents.kept.length,
      events.length,
      "wall events",
      "Most recent, ascending by time",
      AGGREGATE_HINT
    ),
    ladder_rows: sectionScope(
      fitLadder.kept.length,
      ladderRows.length,
      "ladder strikes",
      "Nearest spot, with both king strikes retained",
      "`gexWalls` and `wallIntegrity` above rank the whole ladder, not this sample."
    ),
    flow_prints: sectionScope(
      fitPrints.kept.length,
      prints.length,
      "flow prints",
      "Largest premium first",
      "`flowMarkers.meta` above counts the whole fetch, not this sample."
    ),
    wall_history: sectionScope(
      fitBeads.kept.length,
      beads.length,
      "bead samples",
      "Most recent, ascending by time",
      AGGREGATE_HINT
    ),
  };

  // FINAL KEY ORDER. Everything the model must not lose comes first — the scalars, then the
  // absence and freshness disclosure inherited from `rest`, then the scope notes — and the four
  // trimmable sections come LAST. The object already fits, so nothing should be cut at all; the
  // ordering is belt-and-braces for a downstream caller that annotates it past the cap anyway.
  // The cast is honest and narrow: every key of `T` is still present (the scalars verbatim, the
  // four sections re-populated with elements of their own original type), plus `fit`. Expressing
  // that in the type system would need a mapped type over four optional array keys for no
  // additional safety at the one boundary that calls this.
  return {
    ...base,
    fit: scopes,
    wallEvents: byTimeAsc(fitEvents.kept as Timed[]),
    flowMarkers: flowObj ? { ...flowObj, prints: fitPrints.kept } : (flowMarkers ?? null),
    ladder: ladderObj ? { ...ladderObj, rows: byStrikeDesc(fitLadder.kept as LadderRow[]) } : (ladder ?? null),
    wallHistory: byTimeAsc(fitBeads.kept as Timed[]),
  } as unknown as T & { fit: VectorFullStateFitScopes };
}

// Keep `get_vector_analytics` inside Largo's per-`tool_result` budget, with honest sample scopes.
//
// Side-effect-free (NO `import "server-only"`) so it is unit-testable under `tsx --test`.
//
// WHY THIS EXISTS — AND WHAT IT IS *NOT*
// --------------------------------------
// This is NOT the `get_vector_full_state` defect (#2649), where the payload ran up to 948x the
// transport cap and the model received a fraction of one percent. Measured 2026-08-23 by
// reconstructing this payload at the tool's own documented caps (`MAX_SCREENER_ROWS = 15` x 3
// presets, `MAX_PIVOTS = 12`, `MAX_EVENTS = 8`, `MAX_BUCKETS = 8`, `DAILY_REGIME_DEFAULT_DAYS = 15`,
// `DEFAULT_MAX_COMPARISONS = 4`):
//
//   regimeDays=1   12,622 chars   79% of the 16,000 cap   under the 14,000 budget
//   regimeDays=15  13,938         87%                     at it (1.00x)   <- default
//   regimeDays=22  14,596         91%                     OVER the budget
//   regimeDays=30  15,348         96%                     OVER the budget
//
// So the transport cap is never breached at any `regimeDays` its own clamp accepts. What IS gone
// is the margin: `LARGO_RESULT_CHAR_BUDGET` (14,000) sits deliberately below the 16,000 transport
// cap because "a caller may still round, wrap or annotate the object afterwards", and from
// `regimeDays` ~16 upward this payload has already spent it.
//
// Three facts make that worth fixing rather than watching:
//
//   1. `screener` alone is ~49% of the payload — three presets x fifteen rows.
//   2. `daily_regime` scales linearly with `regimeDays`, which is CALLER-SETTABLE and clamped to
//      [1, 30]. The one parameter a model can vary is the one that eats the remaining headroom.
//   3. Key order puts `unavailable_sections` and `coaching_scope` LAST, so the first thing any
//      future overflow would take is the absence labelling — exactly the shape #2649 fixed.
//
// A P4 that removes a whole class of future P1 is worth its lines. The honest framing matters
// though: this is margin restoration, not a live truncation being repaired.
//
// (An earlier estimate put this at 102% of the cap — over. That was wrong: it modelled
// `ticker_comparison` at fifteen rows when `DEFAULT_MAX_COMPARISONS` caps it at four peers plus
// the active ticker. Corrected in `VECTOR-MAP.md` section 6. Recorded here because the next
// person to re-derive these numbers should know which input was the soft one.)

import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { sectionScope, type VectorSectionScope } from "@/lib/bie/vector-fit-scope";

type UnknownRecord = Record<string, unknown>;

/** Floors — below these a section stops being informative, so the ladder never goes past them. */
export const VECTOR_ANALYTICS_MIN_REGIME_ROWS = 3;
export const VECTOR_ANALYTICS_MIN_SCREENER_ROWS = 5;
export const VECTOR_ANALYTICS_MIN_PIVOTS = 6;

export type VectorAnalyticsFitScopes = {
  daily_regime_rows: VectorSectionScope;
  screener_rows: VectorSectionScope;
  market_structure_pivots: VectorSectionScope;
};

/**
 * Reduction ladder, applied CUMULATIVELY in order, stopping at the first rung that fits.
 *
 * Ordered by information-per-byte for the question this tool answers ("what is this ticker doing
 * right now"), least valuable trimmed first:
 *
 *   - `daily_regime` is multi-session HISTORY and is also the caller-settable growth term, so it
 *     gives up rows first. Its own `coverage` block keeps stating the real window either way.
 *   - `screener` rows go next: it is the largest single block, and each preset already reports
 *     `matched_universe` / `rankable_rows`, which are the numbers a reader should quote — the rows
 *     themselves are illustration.
 *   - `market_structure.pivots` last and least: `events` and `latest_event` carry the actionable
 *     read (BOS vs CHoCH) and are never trimmed at all.
 *
 * `Infinity` means "leave this section alone at this rung".
 */
const LADDER: ReadonlyArray<{ regime: number; screener: number; pivots: number }> = [
  { regime: Infinity, screener: Infinity, pivots: Infinity },
  { regime: 15, screener: Infinity, pivots: Infinity },
  { regime: 10, screener: Infinity, pivots: Infinity },
  { regime: 5, screener: Infinity, pivots: Infinity },
  { regime: 5, screener: 10, pivots: Infinity },
  { regime: 5, screener: 8, pivots: Infinity },
  { regime: VECTOR_ANALYTICS_MIN_REGIME_ROWS, screener: 6, pivots: Infinity },
  {
    regime: VECTOR_ANALYTICS_MIN_REGIME_ROWS,
    screener: VECTOR_ANALYTICS_MIN_SCREENER_ROWS,
    pivots: VECTOR_ANALYTICS_MIN_PIVOTS,
  },
];

const SCREENER_PRESETS = ["nearest_flip", "most_pinned", "most_explosive"] as const;

function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Most recent sessions — `loadDailyRegime` returns rows ascending, so the tail is the live end. */
function keepNewest<T>(rows: readonly T[], cap: number): T[] {
  return cap === Infinity || rows.length <= cap ? [...rows] : rows.slice(rows.length - cap);
}

/** Top of a ranking — `screenUniverse` already sorted these, so the head is the answer. */
function keepTop<T>(rows: readonly T[], cap: number): T[] {
  return cap === Infinity || rows.length <= cap ? [...rows] : rows.slice(0, cap);
}

/** Total screener rows across the three presets — the denominator for the screener scope. */
function screenerRowTotals(screener: UnknownRecord | null): number {
  if (!screener) return 0;
  let n = 0;
  for (const key of SCREENER_PRESETS) {
    n += asArray(asRecord(screener[key])?.rows).length;
  }
  return n;
}

/**
 * Apply one ladder rung, returning a NEW payload. Pure — never mutates its input.
 *
 * Every counter a preset publishes about itself is recomputed from what actually survives, so
 * `returned` can never claim rows the payload no longer carries. `matched_universe`,
 * `rankable_rows` and `excluded_no_metric` are facts about the SCREEN rather than about the
 * sample, so they are carried through untouched — those are the numbers the tool description tells
 * the model to quote, and trimming rows must not disturb them.
 */
function applyRung(
  payload: UnknownRecord,
  rung: { regime: number; screener: number; pivots: number }
): UnknownRecord {
  const out: UnknownRecord = { ...payload };

  const regime = asRecord(payload.daily_regime);
  if (regime) {
    out.daily_regime = { ...regime, rows: keepNewest(asArray(regime.rows), rung.regime) };
  }

  const screener = asRecord(payload.screener);
  if (screener) {
    const nextScreener: UnknownRecord = { ...screener };
    for (const key of SCREENER_PRESETS) {
      const preset = asRecord(screener[key]);
      if (!preset) continue;
      const rows = keepTop(asArray(preset.rows), rung.screener);
      const rankable = typeof preset.rankable_rows === "number" ? preset.rankable_rows : rows.length;
      nextScreener[key] = {
        ...preset,
        rows,
        returned: rows.length,
        // `truncated` means "this list is a top-N of a longer ranking" — still true, and now true
        // for a second reason. One flag, one meaning, recomputed rather than trusted.
        truncated: rows.length < rankable,
      };
    }
    out.screener = nextScreener;
  }

  const structure = asRecord(payload.market_structure);
  if (structure) {
    out.market_structure = {
      ...structure,
      // Pivots are a sequence and the tail is the live part — the same slice direction
      // `computeVectorBarAnalytics` already applies with MAX_PIVOTS.
      pivots: keepNewest(asArray(structure.pivots), rung.pivots),
    };
  }

  return out;
}

/**
 * Insert `fit` immediately after the time anchors instead of appending it.
 *
 * The lesson of #2649: `raw.slice(0, MAX)` is a HEAD slice, so whatever sits last in key order is
 * what a cut takes first — and a disclosure block is the worst possible thing to lose. This
 * payload already fits by the time we get here, so nothing should be cut at all; placing the block
 * early is defence for the case where a caller annotates the object past the cap afterwards.
 * Every other key keeps its original position.
 */
function withFitBlockEarly(payload: UnknownRecord, fit: VectorAnalyticsFitScopes): UnknownRecord {
  const out: UnknownRecord = {};
  let inserted = false;
  for (const [k, v] of Object.entries(payload)) {
    out[k] = v;
    if (!inserted && k === "session_ymd") {
      out.fit = fit;
      inserted = true;
    }
  }
  if (!inserted) out.fit = fit;
  return out;
}

export type FitVectorAnalyticsOptions = { budget?: number };

/**
 * Return the model-facing view of a Vector analytics payload, inside `budget`.
 *
 * Walks {@link LADDER} and returns the first rung whose serialized whole fits — measuring the
 * ENTIRE object each time rather than summing section sizes, so the envelope, keys and commas
 * count against the same budget the transport measures. If even the last rung is over (a
 * pathological base), the last rung is still returned: trimming to the floor and disclosing it is
 * strictly better than serving the untrimmed payload and letting the transport cut blind.
 *
 * Passing a payload with `available: false` through is deliberate — an error envelope is small,
 * carries no rows, and must reach the model unaltered.
 */
export function fitVectorAnalyticsForModel<T extends UnknownRecord>(
  payload: T,
  opts: FitVectorAnalyticsOptions = {}
): UnknownRecord {
  const { budget = LARGO_RESULT_CHAR_BUDGET } = opts;
  if (payload?.available === false) return payload;

  const regimeTotal = asArray(asRecord(payload.daily_regime)?.rows).length;
  const screenerTotal = screenerRowTotals(asRecord(payload.screener));
  const pivotTotal = asArray(asRecord(payload.market_structure)?.pivots).length;

  // Assemble the FULL candidate — trimmed sections AND the fit block — before measuring. The block
  // is several hundred characters and lives inside the same payload, so budgeting the trimmed
  // sections alone and appending it afterwards silently overshoots: measured against the sections
  // only, `regimeDays = 22` came in at 13.9k and left with 14,004. Measure what is actually served.
  const candidate = (rung: (typeof LADDER)[number]): UnknownRecord => {
    const trimmed = applyRung(payload, rung);
    const fit: VectorAnalyticsFitScopes = {
      daily_regime_rows: sectionScope(
        asArray(asRecord(trimmed.daily_regime)?.rows).length,
        regimeTotal,
        "recorded sessions",
        "Most recent sessions",
        "`daily_regime.coverage` states the real window this history spans — quote that, never a count of the rows here."
      ),
      screener_rows: sectionScope(
        screenerRowTotals(asRecord(trimmed.screener)),
        screenerTotal,
        "screener rows across the three presets",
        "Top of each preset's own ranking",
        "Each preset's `matched_universe` and `rankable_rows` are its real denominators — quote those for any 'how many names are X' question, never a count of the rows here."
      ),
      market_structure_pivots: sectionScope(
        asArray(asRecord(trimmed.market_structure)?.pivots).length,
        pivotTotal,
        "labelled pivots",
        "Most recent pivots",
        "`market_structure.events` and `latest_event` are never sampled — the BOS/CHoCH read is complete regardless of how many pivots are shown."
      ),
    };
    return withFitBlockEarly(trimmed, fit);
  };

  let chosen = candidate(LADDER[0]!);
  for (const rung of LADDER) {
    chosen = candidate(rung);
    if (JSON.stringify(chosen).length <= budget) break;
  }
  return chosen;
}

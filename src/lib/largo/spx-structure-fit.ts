/**
 * Fit `get_spx_structure`'s payload under the transport's per-`tool_result` cap.
 *
 * MEASURED, NOT SUSPECTED. `scripts/audit/largo-truncation-probe.mjs` probed all eight SPX Slayer
 * tools on 2026-08-23 with the control PROVEN in both batches, and `get_spx_structure` came back
 * **TRUNCATED with no arguments** — i.e. as normally called, not at some contrived window. It was
 * the only SPX tool that did. (`get_spx_engine_snapshots` truncated only when asked for "the
 * largest window available" and is COMPLETE at its own default of 20, so it is NOT a defect: every
 * list tool truncates if you ask for enough of it.)
 *
 * WHY THAT MATTERS MORE HERE THAN ELSEWHERE. `anthropicToolLoop` keeps the HEAD and discards the
 * tail (`raw.slice(0, MAX_TOOL_RESULT_CHARS)`), so key order decides what survives. `SpxDeskSummary`
 * happens to put its scalars first, which means the desk's core numbers — price, VIX, VWAP, gamma
 * flip, GEX, max pain — DO reach the model. What falls off the end is the enrichment tail:
 * `unified_tape`, `news_headlines`, `macro_events`, `sector_heat`, `leader_stocks`, `oi_changes`,
 * `iv_term_structure`, `greek_exposure`, `market_breadth`, `mag7_greek_flow`, `macro_indicators`,
 * `strike_stacks`. So the damage is narrower than a truncation usually is — and it is still real,
 * because the model cannot distinguish "this field was cut off" from "this field was empty". Asked
 * "what's the macro backdrop for SPX", it answers from an absence it has no way to name.
 *
 * THE RULE (from fit-tool-result.ts): a model-facing result puts its aggregates first and its row
 * samples last, and SAYS OUT LOUD how much of each list it kept. This module does the second half
 * for a payload whose ordering is already right — the scalars stay untouched, the lists are capped
 * to a stated number of rows, and every list that was shortened names itself in `sample_notes`.
 *
 * WHY CAPS RATHER THAN A PURE BUDGET LOOP. `fitRowsToBudget` fits ONE list against a base. This
 * payload has a dozen, of very different value per byte: a 200-row `unified_tape` is worth less to
 * an answer than six `news_headlines`. Fixed per-list caps encode that judgment where a reader can
 * see and argue with it; the budget pass afterwards is the backstop for a day when even the capped
 * lists do not fit.
 *
 * WHY AT THE LARGO BOUNDARY AND NOT IN `summarizeSpxDesk`. That function also feeds Night Hawk's
 * edition builder and the platform snapshot, which want the full lists. Trimming there to fix a
 * model-transport problem would take data away from two consumers that have no cap. Same reasoning
 * as `spx-confidence-boundary.ts`: change what the MODEL sees, leave the product alone.
 */
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

/**
 * Per-list row caps, in the order a reader should argue with them.
 *
 * `cap` is how many rows the model keeps. It is a judgment about value-per-byte, not a size
 * calculation — `unified_tape` is the single fattest field and the least answerable-from, while
 * `gex_walls` is small and is the whole point of half the questions this tool serves.
 */
export const SPX_STRUCTURE_LIST_CAPS: ReadonlyArray<{ key: string; cap: number }> = [
  { key: "gex_walls", cap: 12 },
  { key: "strike_stacks", cap: 8 },
  { key: "spx_flows", cap: 12 },
  { key: "news_headlines", cap: 6 },
  { key: "macro_events", cap: 6 },
  { key: "leader_stocks", cap: 8 },
  { key: "sector_heat", cap: 8 },
  { key: "oi_changes", cap: 8 },
  { key: "unified_tape", cap: 10 },
  { key: "net_prem_ticks", cap: 0 },
];

/**
 * Shed order for the backstop pass — LEAST useful first.
 *
 * Only reached when the capped payload still does not fit, which the caps alone should prevent.
 * A shed field is REPLACED by a note rather than deleted, so the model reads "omitted to fit"
 * instead of an absence it would otherwise report as "no data".
 */
export const SPX_STRUCTURE_SHED_ORDER: readonly string[] = [
  "net_prem_ticks",
  "unified_tape",
  "oi_changes",
  "sector_heat",
  "mag7_greek_flow",
  "macro_indicators",
  "iv_term_structure",
  "market_breadth",
  "leader_stocks",
];

const size = (o: unknown) => JSON.stringify(o)?.length ?? 0;

export type FitSpxStructureResult<T> = {
  fitted: T & { sample_notes?: Record<string, string> };
  /** Serialized size after fitting — asserted by the unit test, not merely observed. */
  chars: number;
  /** Lists that were shortened or dropped, for the run log. */
  trimmed: string[];
};

/**
 * Return a copy of the desk summary bounded to `budget`, with every shortened list named.
 *
 * Non-array fields are never touched: this cannot turn a scalar into a note, so no consumer of a
 * scalar can be surprised by it. A payload already under budget with no over-cap list comes back
 * byte-identical and with no `sample_notes` key at all — an empty note object would itself be a
 * claim ("nothing was trimmed") that costs bytes to make on every call.
 */
export function fitSpxStructureForModel<T extends Record<string, unknown>>(
  summary: T,
  { budget = LARGO_RESULT_CHAR_BUDGET } = {}
): FitSpxStructureResult<T> {
  if (summary == null || typeof summary !== "object") {
    return { fitted: summary as never, chars: size(summary), trimmed: [] };
  }
  const out: Record<string, unknown> = { ...summary };
  const notes: Record<string, string> = {};
  const trimmed: string[] = [];

  for (const { key, cap } of SPX_STRUCTURE_LIST_CAPS) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    if (value.length <= cap) continue;
    out[key] = value.slice(0, cap);
    notes[key] = `${cap} of ${value.length} — a SAMPLE kept to fit the model's payload cap, not the whole list.`;
    trimmed.push(key);
  }

  // Backstop. Sheds whole fields, least-useful first, until the whole thing fits.
  for (const key of SPX_STRUCTURE_SHED_ORDER) {
    if (size({ ...out, sample_notes: notes }) <= budget) break;
    if (!(key in out) || out[key] == null) continue;
    delete out[key];
    notes[key] = "omitted to fit the model's payload cap — NOT absent from the desk.";
    if (!trimmed.includes(key)) trimmed.push(key);
  }

  // HARD BOUND — last resort, and the reason it exists is worth stating.
  //
  // The shed order deliberately protects the high-value fields (`gex_walls`, `spx_flows`,
  // `strike_stacks`, `news_headlines`, `macro_events`). If ONE of those is enormous on its own, the
  // two passes above leave the payload over budget and the transport takes an unnamed slice — the
  // exact failure this module exists to prevent, arriving after two passes that looked like they
  // handled it. A bounded, NAMED cut is always better than an unnamed one, so a protected list is
  // shortened rather than allowed to overflow. Found by the unit test, not in production.
  //
  // Shrinks the largest remaining array first, halving each pass, so the cut lands where the bytes
  // actually are instead of nibbling evenly across fields of very different sizes.
  const arrayKeys = () =>
    Object.keys(out).filter((k) => Array.isArray(out[k]) && (out[k] as unknown[]).length > 0);
  let guard = 200;
  while (size({ ...out, sample_notes: notes }) > budget && arrayKeys().length && guard-- > 0) {
    const biggest = arrayKeys().sort((a, b) => size(out[b]) - size(out[a]))[0]!;
    const arr = out[biggest] as unknown[];
    const original =
      typeof notes[biggest] === "string" && /of (\d+)/.exec(notes[biggest])
        ? Number(/of (\d+)/.exec(notes[biggest])![1])
        : arr.length;
    const next = Math.floor(arr.length / 2);
    out[biggest] = arr.slice(0, next);
    notes[biggest] = `${next} of ${original} — a SAMPLE cut further to fit the model's payload cap, not the whole list.`;
    if (!trimmed.includes(biggest)) trimmed.push(biggest);
  }

  if (trimmed.length) out.sample_notes = notes;
  return { fitted: out as FitSpxStructureResult<T>["fitted"], chars: size(out), trimmed };
}

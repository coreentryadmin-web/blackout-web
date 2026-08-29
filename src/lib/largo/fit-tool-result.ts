/**
 * Fit a model-facing tool result under the transport's per-`tool_result` cap.
 *
 * WHY THIS EXISTS. `anthropicToolLoop` caps every tool_result at
 * `MAX_TOOL_RESULT_CHARS` by **keeping the head and discarding the tail**
 * (`raw.slice(0, MAX) + "…[truncated]"`). That is the correct thing for the
 * transport to do — an uncapped heavy tool re-sent every loop round overflows the
 * context window and Anthropic 400s. But a tail cut means **key order decides what
 * survives**, and a reader that returns a raw product object gets its ordering from
 * whatever the UI/API consumer needed, not from what the model needs.
 *
 * That is how `get_zerodte_record` came to deliver 1.5% of itself: the record
 * serializes `plays` third, each play carrying its full `entry_context` commit
 * forensics (94% of the payload), so the cut landed inside play #2 and **every
 * aggregate** — `wins`, `losses`, `win_rate_pct`, `by_outcome`, `mechanical` — fell
 * off the end. The tool whose entire job is the track record shipped the model a
 * methodology paragraph and an unterminated JSON fragment.
 *
 * The rule this module encodes: **a model-facing tool result puts its aggregates
 * first and its row sample last, and says out loud how much of the list it kept.**
 * Ordering first, so that if the cap is ever hit anyway the transport eats the
 * sample rather than the answer. Saying so out loud second, because a silently
 * shortened list is the same defect as a truncated one — the model cannot tell a
 * 25-row sample from a 25-row universe, and would report "182 plays" as "25".
 */
import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";

/**
 * Character budget for an assembled tool result.
 *
 * Deliberately BELOW the transport cap. The headroom absorbs the difference between
 * what we measure here and what the loop actually serializes (a caller may still
 * round, wrap or annotate the object afterwards). Landing exactly on the cap would
 * mean any downstream byte re-introduces the tail cut this module exists to prevent.
 */
export const LARGO_RESULT_CHAR_BUDGET = Math.floor(MAX_TOOL_RESULT_CHARS * 0.875); // 14_000

export type FitRowsResult<Row> = {
  /** The rows that fit, in the order given. */
  kept: Row[];
  /** How many rows the caller handed us — the number the model must be told. */
  total: number;
  /** Serialized size of the assembled object, for tests and telemetry. */
  chars: number;
};

/**
 * Add `rows` to `base` under `key` while the serialized whole stays inside `budget`.
 *
 * Rows are added in the order supplied, so the caller decides what "most relevant"
 * means (newest-first for a ledger, highest-rank for a board). Measuring the WHOLE
 * assembled object each step — rather than summing row sizes — is what makes the
 * bound real: the base object, the key, the commas and the JSON envelope all count
 * against the same budget the transport will measure.
 *
 * `maxRows` is a second, independent ceiling. Budget alone would let a window of
 * very small rows put hundreds of plays in front of the model, which is a reading
 * problem rather than a size one — nobody asked "list every play", and a long list
 * crowds out the aggregates in the model's attention even when it fits in bytes.
 */
export function fitRowsToBudget<Row>(
  base: Record<string, unknown>,
  key: string,
  rows: readonly Row[],
  { budget = LARGO_RESULT_CHAR_BUDGET, maxRows = Number.POSITIVE_INFINITY } = {}
): FitRowsResult<Row> {
  const ceiling = Math.min(rows.length, maxRows);
  const kept: Row[] = [];
  // Start from the base alone: if even that does not fit, the caller has an
  // aggregate-shape problem and must learn it from `chars`, not from a silent drop.
  let chars = JSON.stringify({ ...base, [key]: kept }).length;
  for (let i = 0; i < ceiling; i++) {
    const next = [...kept, rows[i]];
    const nextChars = JSON.stringify({ ...base, [key]: next }).length;
    if (nextChars > budget) break;
    kept.push(rows[i]);
    chars = nextChars;
  }
  return { kept, total: rows.length, chars };
}

export type FitEnvelopeResult<Row> = FitRowsResult<Row> & {
  /** The exact object the tool will return, measured byte-for-byte. */
  envelope: Record<string, unknown>;
};

/**
 * Grow `rows` inside `build(kept, total)` until the serialized envelope hits `budget`.
 *
 * Unlike `fitRowsToBudget`, the caller owns the FULL return shape — metadata fields
 * (`shown`, `truncated`, `source`, `note`, `summary`, …) are included in every size
 * check. #3166's first budget pass measured only `{ [key]: rows }`, so tools that
 * return a wider envelope (or even `{ changes, shown, truncated, max_shown }`) could
 * still live-truncate despite passing unit tests on the inner slice alone.
 */
export function fitEnvelopeToBudget<Row>(
  rows: readonly Row[],
  build: (kept: Row[], total: number) => Record<string, unknown>,
  { budget = LARGO_RESULT_CHAR_BUDGET, maxRows = Number.POSITIVE_INFINITY } = {}
): FitEnvelopeResult<Row> {
  const ceiling = Math.min(rows.length, maxRows);
  const kept: Row[] = [];
  let envelope = build([], rows.length);
  let chars = JSON.stringify(envelope).length;
  for (let i = 0; i < ceiling; i++) {
    const next = [...kept, rows[i]];
    const candidate = build(next, rows.length);
    const nextChars = JSON.stringify(candidate).length;
    if (nextChars > budget) break;
    kept.push(rows[i]);
    envelope = candidate;
    chars = nextChars;
  }
  return { kept, total: rows.length, chars, envelope };
}

/**
 * The sentence the model reads so a sample is never mistaken for the universe.
 *
 * States three things a truncated list cannot: how many rows are here, how many
 * exist, and — the one that actually prevents a wrong answer — that the aggregates
 * were computed over ALL of them, not over this sample.
 */
export function sampleNote(kept: number, total: number, noun: string, detailHint?: string): string {
  const scope =
    total === 0
      ? // "All 0 committed plays" reads as a malformed sentence and invites the model to
        // treat it as a parse failure rather than a real, reportable state. An empty window
        // is a legitimate answer — pre-open, a holiday, a session the firewall held entirely.
        `No ${noun} in the window.`
      : kept >= total
        ? `All ${total} ${noun} in the window.`
        : `Most recent ${kept} of ${total} ${noun} in the window, newest first — a SAMPLE, not the whole list. ` +
          `Every aggregate in this result is computed over all ${total}, never over these ${kept}: ` +
          `quote the aggregates for any count, rate or total.`;
  return detailHint ? `${scope} ${detailHint}` : scope;
}

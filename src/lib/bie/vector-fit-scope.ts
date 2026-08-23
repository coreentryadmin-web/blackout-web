// Sample-scope disclosure shared by Vector's model-facing tool fits.
//
// Side-effect-free (NO `import "server-only"`) so it is unit-testable under `tsx --test`.
//
// Extracted from `vector-full-state-fit.ts` (#2649) when the SECOND Vector tool needed the same
// device. One convention across both matters more than the few lines it saves: a reader who has
// learned what `fit.<section>.total` means on `get_vector_full_state` must not meet a differently
// named or differently worded version of the same idea on `get_vector_analytics`, because the
// whole point of the block is that it can be trusted without being re-read.

/**
 * What a shortened list cannot say for itself: how many rows are here, how many exist, and — the
 * one that actually prevents a wrong answer — whether this is a sample at all.
 */
export type VectorSectionScope = {
  returned: number;
  total: number;
  truncated: boolean;
  note: string;
};

/**
 * Build one section's scope note.
 *
 * `keptDescription` says WHICH rows survived (the selection rule, e.g. "Most recent"), and
 * `aggregateHint` says what to cite instead of counting them. Both are caller-supplied because
 * they are genuinely different per section — a bead rail keeps the newest, a ladder keeps the
 * ones nearest spot, and what a reader should cite instead differs accordingly.
 */
export function sectionScope(
  returned: number,
  total: number,
  noun: string,
  keptDescription: string,
  aggregateHint: string
): VectorSectionScope {
  const truncated = returned < total;
  const note =
    total === 0
      ? // "All 0 samples" reads as a malformed sentence and invites a model to treat it as a parse
        // failure rather than a real, reportable state. An empty section is often a correct answer
        // and the payload's own `*_empty_reason` fields say which kind of empty it is.
        `No ${noun} on this read.`
      : truncated
        ? `${keptDescription} — ${returned} of ${total} ${noun}, a SAMPLE, not the whole set. ${aggregateHint}`
        : `All ${total} ${noun} on this read.`;
  return { returned, total, truncated, note };
}

/**
 * Shape a published Night Hawk edition for the MODEL's copy.
 *
 * WHY. `get_nighthawk_edition` returned `rowToNightHawkEdition`'s raw object, which
 * inserts `market_recap` (key 6) before `plays` (key 7). On a live edition that is
 * 41,471 bytes of recap in front of 5,239 bytes of plays — and the answer loop caps
 * every tool_result at `MAX_TOOL_RESULT_CHARS` with a **tail** slice. Measured on
 * prod 2026-08-21: the whole edition is 47,307 chars, `"plays":` begins at char
 * 42,001, and the cut lands at 16,000. **Every Night Hawk play was cut off**, from
 * the tool whose description promises "all plays with rank, conviction, thesis,
 * entry/target/stop, score, flow streak, and IV rank".
 *
 * Two rules, the same ones the 0DTE record fix established:
 *
 * 1. **The product goes first.** `plays` is what this tool exists to deliver, so it
 *    is emitted before the recap. Under a tail cut the recap must be what is lost.
 * 2. **Say what was left out.** `spx_desk` (21,914B) and `flow_tape` (14,170B) are
 *    the two heavyweights, and both are whole snapshots that DEDICATED tools already
 *    serve live — `get_spx_structure` and `get_flow_tape`. Carrying stale copies of
 *    them inside the edition bought nothing and cost the plays. But dropping them
 *    silently would be its own defect: the model would report "no SPX context in
 *    tonight's edition" when the truth is "ask the SPX tool". So the omission is
 *    named, with the tool to call instead.
 *
 * Everything genuinely edition-specific stays: the recap headline/summary, catalysts,
 * after-hours catalysts, sector strength/weakness and tides, index flows, hot chains,
 * VIX term and IV rank, index dossiers, top net impact.
 */

/** Recap sub-blobs that are live snapshots owned by another tool, not edition content.
 *  Keyed by the tool a member question about them should actually route to. */
export const DELEGATED_RECAP_BLOBS: Record<string, string> = {
  spx_desk: "get_spx_structure",
  flow_tape: "get_flow_tape",
};

export type ModelEdition = Record<string, unknown>;

type EditionLike = {
  available?: boolean;
  edition_for?: string | null;
  published_at?: string | null;
  recap_headline?: string | null;
  recap_summary?: string | null;
  market_recap?: Record<string, unknown> | null;
  plays?: unknown[];
  recap_only?: boolean;
  recap_only_reason?: unknown;
  funnel?: unknown;
};

/**
 * Pure reshaping — no IO, so the ordering and omission rules are unit-testable
 * without a database or a published edition.
 */
export function compactNightHawkEditionForModel(edition: EditionLike | null): ModelEdition {
  if (!edition) {
    // NO EDITION IS NOT AN EDITION WITH NO PLAYS. This used to return
    // `{ available: false, play_count: 0, plays: [] }`, which says both "there is nothing here"
    // and "here is the count, and it is zero" in one payload — and a model reads the number. The
    // two states are genuinely different: an edition published with no surviving plays is a
    // measured funnel result (and keeps its `recap_only_reason` below), while no edition at all
    // means nothing was published for this date. Only the second one has no count to give.
    return {
      available: false,
      reason: "no_edition_published",
      note:
        "No Night Hawk edition has been published for this date. This is NOT an edition with " +
        "zero plays — there is deliberately no play count here, so do not report one.",
    };
  }

  const recap = edition.market_recap ?? {};
  const omitted: string[] = [];
  const keptRecap: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(recap)) {
    if (key in DELEGATED_RECAP_BLOBS) omitted.push(key);
    else keptRecap[key] = value;
  }

  const plays = Array.isArray(edition.plays) ? edition.plays : [];

  return {
    available: edition.available ?? plays.length > 0,
    edition_for: edition.edition_for ?? null,
    published_at: edition.published_at ?? null,
    // FIRST on purpose — see rule 1. A tail cut must eat the recap, never the picks.
    play_count: plays.length,
    plays,
    recap_headline: edition.recap_headline ?? null,
    recap_summary: edition.recap_summary ?? null,
    recap_only: edition.recap_only ?? false,
    recap_only_reason: edition.recap_only_reason ?? null,
    funnel: edition.funnel ?? null,
    market_recap: keptRecap,
    // Named, not silent — see rule 2. Absence of a field must never read as absence
    // of the data; it means "that data lives behind another tool".
    market_recap_omitted: omitted,
    market_recap_omitted_note: omitted.length
      ? `Omitted from this result to keep the plays deliverable: ${omitted
          .map((k) => `${k} (call ${DELEGATED_RECAP_BLOBS[k]} for it, live)`)
          .join("; ")}. These are live snapshots owned by those tools, not edition content — ` +
        `their absence here does NOT mean the data is unavailable.`
      : null,
  };
}

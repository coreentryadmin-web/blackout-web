"use client";

import type { BieTable } from "@/lib/bie/answer-envelope";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";

/**
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): `BieSection.table` — the structured,
 * joinable row data (Largo product-contract C10 "historical context") that
 * `archetypeTrackRecordSection`/`tickerTrackRecordSection` (swing play-brief-intel.ts) attach
 * deliberately "so a consumer should be able to join/cite the underlying numbers, not just parse
 * prose" — reaches `BieSection.table` on the wire (wired through `buildRichEnvelope` specifically
 * for this reason) and is already rendered into `envelope.markdown` by `renderEnvelopeMarkdown`'s
 * `renderTable()`. But `BieSectionCard`, the only renderer of a `BieSection` in the member-facing
 * "Deep dive" UI (`BieAnswer.tsx`), never read `section.table` at all — it rendered `body`,
 * `evidence`, `levels`, `confidence` and `provenance`, but the table a member can actually use to
 * compare a position's archetype/ticker track record (win rate, Wilson LB, edge, N) by scope was
 * silently dropped between the composer and the screen. `envelope.markdown` (the string that
 * *does* carry the table, via `renderTable()`) is never read anywhere in `src/features/largo` —
 * the structured UI binds to the typed fields directly — so this data had no path to a member at
 * all, the same "reaches the wire but the shared renderer never read it" shape as the sibling
 * `market_session_note` fix (`BieChips.tsx`) and `rung.meta`/`subLaneTrackRecord` fix
 * (`BieStructureLadder.tsx`) landed the same week.
 *
 * Renders a real `<table>` (not the ARIA-div grid `BieKeyLevelsTable` uses) because `BieTable`'s
 * column count is caller-defined (3 columns for the ticker track record, 6 for the archetype
 * one) — a fixed `grid-template-columns` would mis-align a different shape.
 */
export function BieSectionTable({ table }: { table: BieTable | null | undefined }) {
  if (!table || !table.headers?.length) return null;
  return (
    <div className="bie-section-table-wrap">
      <table className="bie-section-table">
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={`${h}-${i}`} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{renderInlineMarkdown(String(cell))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

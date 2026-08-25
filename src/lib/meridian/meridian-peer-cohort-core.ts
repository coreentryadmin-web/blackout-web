/**
 * Shared sector-peer cohort builder — used by the desk panel and Largo.
 *
 * The cohort is a cross-event computation over the loaded timeline window: same-SIC-major-group
 * earnings names reporting alongside the subject. Lives here (not in the client panel) so the
 * server-side Largo tool reuses the exact same classification the UI renders.
 */

import {
  buildSectorCohort,
  type SectorCohort,
} from "@/lib/meridian/meridian-sector-core";

/** Minimal timeline row shape — satisfied by `MeridianTimelineItem` and Largo timeline items. */
export type MeridianPeerCohortTimelineRow = {
  kind: string;
  ticker: string | null;
  date: string;
  expected_move_pct?: number | null;
  sic_major_group?: string | null;
  sector_label?: string | null;
};

export function buildCohortForTimelineItem(
  item: MeridianPeerCohortTimelineRow,
  allItems: readonly MeridianPeerCohortTimelineRow[]
): SectorCohort | null {
  const group = item.sic_major_group;
  if (!group || !item.ticker) return null;
  const peers = (allItems ?? [])
    .filter(
      (i) =>
        i.kind === "earnings" &&
        i.sic_major_group === group &&
        i.ticker &&
        i.ticker !== item.ticker
    )
    .map((i) => ({
      ticker: i.ticker!,
      value: i.expected_move_pct ?? null,
      date: i.date,
    }));

  return buildSectorCohort({
    subject: item.ticker,
    subjectValue: item.expected_move_pct ?? null,
    classification: {
      majorGroup: group,
      label: item.sector_label ?? null,
      sicCode: null,
      sicDescription: null,
    },
    peers,
  });
}

"use client";

/**
 * PEER COHORT — where this name's implied move sits among the peers reporting alongside it.
 *
 * A single implied move is a number without a scale. Semis routinely price 7-9% into a print
 * while banks price 3%, so "7.2%" is only rich, cheap, or normal relative to the group. This
 * panel supplies the group.
 *
 * It draws the peers as a strip with the IQR shaded and the subject marked, because the shape of
 * the cohort is the point: four peers clustered at 4% with one at 12% is a different picture from
 * five spread evenly, and both would report the same median. Every peer's number is printed next
 * to its ticker — a dot on a strip whose value the reader has to infer from a pixel position is
 * the class of thing this desk has been fixing all week.
 */

import { useMemo } from "react";
import type { MeridianTimelineItem } from "@/features/meridian/lib/meridian-types";
import {
  buildSectorCohort,
  describeCohortPosition,
  type SectorCohort,
} from "@/lib/meridian/meridian-sector-core";

export function buildCohortForItem(
  item: MeridianTimelineItem,
  allItems: readonly MeridianTimelineItem[]
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
    .map((i) => ({ ticker: i.ticker!, value: i.expected_move_pct ?? null, date: i.date }));

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

export function MeridianPeerCohortPanel({
  item,
  allItems,
}: {
  item: MeridianTimelineItem;
  allItems: readonly MeridianTimelineItem[];
}) {
  const cohort = useMemo(() => buildCohortForItem(item, allItems), [item, allItems]);
  if (!cohort) return null;

  const d = cohort.distribution;
  const rows = cohort.members.filter((m) => m.value != null);
  // Scale the strip across the cohort's own range, not 0..max: an all-semis cohort living
  // between 5% and 9% would otherwise render as five dots crowded against the right edge with
  // half the panel empty, hiding exactly the spread the strip exists to show.
  const values = rows.map((m) => m.value!);
  const lo = Math.min(...values, d?.min ?? Infinity);
  const hi = Math.max(...values, d?.max ?? -Infinity);
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="mr-panel mpeer" aria-label="Sector peers">
      <header className="mpeer-head">
        <span className="mr-panel-title">Sector peers</span>
        <span className="mpeer-sector">{cohort.label}</span>
      </header>

      <p className="mpeer-verdict">
        {describeCohortPosition(cohort, { unit: "%", noun: "Implied move" })}
      </p>

      {d && (
        <div className="mpeer-strip" role="img" aria-label={`Implied move distribution, ${d.peers} peers`}>
          {/* IQR band — the middle half of the cohort. Anything outside it is what "rich" and
              "cheap" are measured against, so the band IS the claim being made above. */}
          <span
            className="mpeer-iqr"
            style={{ left: `${x(d.p25)}%`, width: `${Math.max(x(d.p75) - x(d.p25), 0.5)}%` }}
          />
          <span className="mpeer-median" style={{ left: `${x(d.median)}%` }} />
          {rows.map((m) => (
            <span
              key={m.ticker}
              className={`mpeer-dot${m.ticker === item.ticker?.toUpperCase() ? " is-subject" : ""}`}
              style={{ left: `${x(m.value!)}%` }}
              title={`${m.ticker} ${m.value}%`}
            />
          ))}
          <span className="mpeer-axis">
            <b>{lo}%</b>
            <b>{hi}%</b>
          </span>
        </div>
      )}

      <ul className="mpeer-rows">
        {cohort.members.slice(0, 12).map((m) => (
          <li
            key={m.ticker}
            className={`mpeer-row${m.ticker === item.ticker?.toUpperCase() ? " is-subject" : ""}`}
          >
            <span className="mpeer-tkr">{m.ticker}</span>
            <span className="mpeer-when">{m.date ?? ""}</span>
            <span className="mpeer-val">{m.value == null ? "—" : `${m.value}%`}</span>
          </li>
        ))}
      </ul>
      {cohort.members.length > 12 && (
        <span className="msum-thin">+{cohort.members.length - 12} more in cohort</span>
      )}
    </section>
  );
}

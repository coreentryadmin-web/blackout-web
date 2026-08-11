/**
 * LEVEL_ANALYSIS — "what happened at 7800?"
 *
 * The narrowest claim in the library, and the one where the level map has to be exactly right: the
 * question names a specific number, so the card is read as an assertion about that number's
 * relationship to price.
 *
 * SPOT IS A ROW IN THE MAP, not a separate readout. Inserting it in its true sorted position makes
 * the geometry impossible to misread — a wall drawn above spot IS above spot. The terminal's own
 * ladder does this for the same reason, and a card that drew spot off to one side would leave a
 * reader to infer the ordering, which is exactly where an honest number becomes a misleading image.
 *
 * `status` (held / broke / untested) is rendered ONLY when the data supports it. Whether a level
 * held is a claim about the session's path, not about its current position, and inferring it from
 * spot-versus-level would be inventing history from a snapshot. Absent status simply renders no
 * chip.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, GexBars, Headline, Kicker, LevelMap, MetricRow } from "../primitives";

export function LevelAnalysisCard({
  bundle,
  spec,
  recorder,
  asOfLabel,
  focusStrike,
}: {
  bundle: VisualBundle;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  asOfLabel: string | null;
  /** The strike the question named, when it named one — it gets the headline slot. */
  focusStrike?: number | null;
}): ReactElement {
  const focus = focusStrike != null ? bundle.levels?.find((l) => Math.abs(l.price - focusStrike) < 0.51) ?? null : null;

  const title = focus
    ? `${bundle.ticker ?? ""} ${focus.display}`.trim()
    : bundle.headline ?? `${bundle.ticker ?? "Dealer"} levels`;

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="head"
      systems={bundle.systemsQueried.filter((x) => x !== "LARGO")}
      asOfLabel={asOfLabel}
      freshness={bundle.freshness}
      spec={spec}
    />,

    <div key="hl" style={{ display: "flex", flexDirection: "column", marginTop: s(24, spec) }}>
      <Kicker text={focus ? `${focus.label} · level intelligence` : "Level intelligence"} spec={spec} color={C.info} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={title} spec={spec} />
      </div>
      {bundle.summary && (
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(19, spec), color: C.muted, marginTop: s(12, spec), lineHeight: 1.5 }}>
          {bundle.summary}
        </div>
      )}
    </div>,

    // The map is the card. It gets the most room and the largest row count of any template.
    <div key="map" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(26, spec) }}>
      {LevelMap({ levels: bundle.levels, spot: bundle.spot, spec, recorder, max: spec.stack ? 7 : 5 })}
    </div>,

    bundle.gexShifts?.length ? (
      <div key="g" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(26, spec) }}>
        <Kicker text="Gamma change at strike" spec={spec} />
        <div style={{ display: "flex", width: "100%", marginTop: s(12, spec) }}>
          {GexBars({ shifts: bundle.gexShifts, spec, recorder, max: spec.stack ? 4 : 3 })}
        </div>
      </div>
    ) : null,

    /**
     * The metric rail gives way to the level map ONLY when the map actually needs the room.
     *
     * It used to be dropped on every dense surface unconditionally, on the reasoning that the map
     * is the card. True when the map is full — but a three-level answer left ~150px of empty
     * canvas below it while the metrics that would have filled it were discarded by a flag that
     * never looked at how many levels there were. Levels still win the space; they just have to
     * be using it.
     */
    spec.dense && (bundle.levels?.length ?? 0) > 3 ? null : (
      <div key="m" style={{ display: "flex", width: "100%", marginTop: s(24, spec) }}>
        {MetricRow({ metrics: bundle.metrics, spec, recorder, max: 2 })}
      </div>
    ),

  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution={bundle.systemsQueried.join(" · ")} spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

/** Pull a strike out of a level question ("what happened at 7800"). Null when none is named. */
export function focusStrikeFromQuestion(question: string): number | null {
  const m = /\b(?:at|around|near|above|below)\s+\$?(\d[\d,]{2,}(?:\.\d+)?)/i.exec(question ?? "");
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

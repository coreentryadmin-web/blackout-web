/**
 * SCREENER — "which names are nearest their gamma flip?"
 *
 * NEW SHAPE: a ranked table with a proportional metric bar. The three shipped templates cover
 * spatial (level ladder), temporal (trade lifecycle) and argumentative (conclusion + evidence);
 * none of them can express "these N instruments, ordered by one measure". That ordering IS the
 * content here — the reader's question is "who is closest", not "what is NVDA's number".
 *
 * THE BAR IS SCALED WITHIN THE SHOWN ROWS, NOT AGAINST AN ABSOLUTE. A screener's job is relative
 * ranking, and normalising to the widest row in view is what makes rank legible at a glance.
 * The number beside it stays absolute so nobody reads the bar as the value.
 *
 * A SCREEN IS NOT A SCREEN BELOW THREE ROWS — see the sufficiency predicate in router.ts. Two rows
 * ordered by flip distance is a comparison, and presenting it as a market screen overstates how
 * much was looked at.
 *
 * `updated_at` IS LOAD-BEARING and rendered, not decorative: the universe snapshot is rebuilt by a
 * 5-minute cron and served stale by design, so an hour-old "nearest flip" is a materially
 * different claim from a live one and the card has to say which it is.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

/** Preset → the human question it answers. The card leads with the QUESTION, not the preset id. */
const PRESET_TITLE: Record<string, string> = {
  nearest_flip: "Nearest the gamma flip",
  most_pinned: "Most pinned",
  most_explosive: "Most explosive",
};

export function ScreenerCard({
  bundle,
  spec,
  recorder,
  asOfLabel,
}: {
  bundle: VisualBundle;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  asOfLabel: string | null;
}): ReactElement {
  const screen = bundle.screen!;
  const rows = screen.rows.slice(0, spec.stack ? 8 : 6);
  const title = PRESET_TITLE[screen.preset] ?? "Screen";

  // Normalised within the SHOWN rows — relative rank is the content.
  const peak = Math.max(...rows.map((r) => Math.abs(r.metricValue)), 0.0001);

  recorder.value("Screen", title, "VECTOR");
  recorder.value("Universe size", String(screen.universeSize), "VECTOR", screen.updatedAt);

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["VECTOR", "THERMAL"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(24, spec) }}>
      <Kicker text={`Screen · ${screen.universeSize} names`} spec={spec} color={C.info} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={title} spec={spec} />
      </div>
    </div>,

    <div key="rows" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(24, spec) }}>
      {rows.map((r, i) => {
        recorder.value(r.ticker, r.metricDisplay, "VECTOR");
        // Regime colours the row, not the metric: "below the flip" is a condition of the name,
        // whereas the metric is a distance and has no direction of its own.
        const color = r.regime === "above" ? C.bull : r.regime === "below" ? C.bear : C.muted;
        return (
          <div
            key={r.ticker}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: `${s(10, spec)}px ${s(12, spec)}px`,
              marginTop: i === 0 ? 0 : s(6, spec),
              background: "rgba(255,255,255,0.015)",
              borderLeft: `${s(3, spec)}px solid ${color}`,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(15, spec),
                color: C.faint,
                width: s(26, spec),
              }}
            >
              {i + 1}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(22, spec),
                color: C.primary,
                width: s(94, spec),
              }}
            >
              {r.ticker}
            </div>
            <div style={{ display: "flex", flex: 1, height: s(12, spec), background: "rgba(255,255,255,0.03)", marginRight: s(14, spec) }}>
              <div style={{ display: "flex", width: `${Math.max(3, (Math.abs(r.metricValue) / peak) * 100)}%`, height: "100%", background: color }} />
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(20, spec),
                color,
                width: s(104, spec),
                justifyContent: "flex-end",
              }}
            >
              {r.metricDisplay}
            </div>
          </div>
        );
      })}
    </div>,

    <div key="lab" style={{ display: "flex", marginTop: s(14, spec) }}>
      <Kicker text={`${screen.metricLabel} · snapshot rebuilt every 5 min`} spec={spec} />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Vector universe · Thermal" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

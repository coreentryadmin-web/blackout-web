/**
 * BEFORE / AFTER — "what changed in the last N minutes?"
 *
 * BOTH TIMESTAMPS ARE MANDATORY AND BOTH ARE RENDERED. A change card carrying only "now" is not a
 * comparison — it is an assertion that something moved, with no way to check the interval. The two
 * stamps are drawn as column headers so the interval is impossible to miss, and the sufficiency
 * gate refuses the template when either is missing.
 *
 * DIRECTION COMES FROM THE BUNDLE, NOT FROM THE SIGN OF THE DELTA. This is the same trap
 * `GexBars` documents: for a signed quantity that can CROSS ZERO, "up" and "positive" are
 * different facts. Put-wall gamma going from −4.1M to −1.2M is a delta of +2.9M and a WEAKENING
 * of the wall; reading direction off the arithmetic would colour that green. The producing tool
 * knows which it is; the card does not re-derive it.
 *
 * EVERY ROW SHOWS BOTH ENDPOINTS. A row that showed only the delta would be unverifiable and
 * would hide the case where a large-looking move is a large move off a tiny base.
 */

import type { ReactElement } from "react";
import { C, FONT, GLYPH } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function BeforeAfterCard({
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
  const ba = bundle.beforeAfter!;
  const rows = ba.rows.slice(0, spec.stack ? 7 : 5);

  recorder.value("Window", ba.windowLabel, "LARGO");
  recorder.value("Measured at", `${ba.beforeLabel} → ${ba.afterLabel}`, "LARGO");

  const col = { label: s(230, spec), val: s(150, spec) };

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="h"
      systems={bundle.systemsQueried}
      asOfLabel={asOfLabel}
      freshness={bundle.freshness}
      spec={spec}
    />,

    <div
      key="t"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: s(22, spec),
      }}
    >
      <Kicker text={`What changed · ${ba.windowLabel}`} spec={spec} color={C.warn} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={bundle.headline ?? "Since the last read"} spec={spec} />
      </div>
    </div>,

    // Column headers ARE the timestamps. Not chrome — they are what makes the deltas checkable.
    <div
      key="hdr"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        marginTop: s(24, spec),
        paddingBottom: s(8, spec),
        borderBottom: `1px solid ${C.rule}`,
      }}
    >
      <div style={{ display: "flex", width: col.label, flexShrink: 0 }} />
      <div
        style={{
          display: "flex",
          width: col.val,
          flexShrink: 0,
          justifyContent: "flex-end",
          fontFamily: FONT.mono,
          fontSize: s(15, spec),
          letterSpacing: s(2, spec),
          color: C.faint,
        }}
      >
        {ba.beforeLabel}
      </div>
      <div style={{ display: "flex", width: s(44, spec), flexShrink: 0 }} />
      <div
        style={{
          display: "flex",
          width: col.val,
          flexShrink: 0,
          justifyContent: "flex-end",
          fontFamily: FONT.mono,
          fontSize: s(15, spec),
          letterSpacing: s(2, spec),
          color: C.info,
        }}
      >
        {ba.afterLabel}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          justifyContent: "flex-end",
          fontFamily: FONT.mono,
          fontSize: s(15, spec),
          letterSpacing: s(2, spec),
          color: C.faint,
        }}
      >
        CHANGE
      </div>
    </div>,

    <div key="rows" style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {rows.map((r, i) => {
        const color = r.direction === "up" ? C.bull : r.direction === "down" ? C.bear : C.muted;
        const glyph = r.direction === "up" ? GLYPH.up : r.direction === "down" ? GLYPH.down : GLYPH.flat;
        recorder.value(`${r.label} ${ba.beforeLabel}`, r.beforeDisplay, r.source);
        recorder.value(`${r.label} ${ba.afterLabel}`, r.afterDisplay, r.source);
        return (
          <div
            key={`${r.label}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: `${s(11, spec)}px 0`,
              borderBottom: `1px solid ${C.ruleSoft}`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: col.label,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(18, spec),
                  color: C.primary,
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(13, spec),
                  color: C.faint,
                  marginTop: s(2, spec),
                }}
              >
                {r.source}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                width: col.val,
                flexShrink: 0,
                justifyContent: "flex-end",
                fontFamily: FONT.mono,
                fontSize: s(21, spec),
                color: C.muted,
              }}
            >
              {r.beforeDisplay}
            </div>
            <div
              style={{
                display: "flex",
                width: s(44, spec),
                flexShrink: 0,
                justifyContent: "center",
                fontFamily: FONT.mono,
                fontSize: s(17, spec),
                color,
              }}
            >
              {glyph}
            </div>
            <div
              style={{
                display: "flex",
                width: col.val,
                flexShrink: 0,
                justifyContent: "flex-end",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(23, spec),
                color: C.primary,
              }}
            >
              {r.afterDisplay}
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                justifyContent: "flex-end",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(19, spec),
                color,
              }}
            >
              {/* Absent delta renders nothing rather than "0" — a delta that could not be computed
                  is not a delta of zero. */}
              {r.deltaDisplay ?? ""}
            </div>
          </div>
        );
      })}
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Two snapshots · same systems" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

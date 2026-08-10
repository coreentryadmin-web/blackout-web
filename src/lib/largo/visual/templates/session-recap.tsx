/**
 * SESSION RECAP — one whole session, as it closed.
 *
 * THE OHLC BAR IS THE ONE PIECE OF REAL CHART GEOMETRY IN THE LIBRARY, and it is drawn rather than
 * listed because the relationship between open, close and the extremes is the content: a session
 * that closed on its high and a session that gave back a 2% rally have the same four numbers and
 * completely different meanings. The bar makes that difference visible; four labelled values do
 * not.
 *
 * IT IS POSITIONAL, SO IT NEEDS REAL NUMBERS, NOT DISPLAY STRINGS. The bundle carries display
 * strings for text and the card parses them back for geometry — which is exactly the kind of
 * round-trip that silently produces a wrong picture. So it does NOT: the geometry is computed from
 * the SPAN between high and low only when all four values parse as finite numbers, and when they
 * do not the bar is omitted and the four values render as plain rows. A recap missing its bar is
 * worth shipping; a bar drawn from a failed parse is not.
 *
 * POST-CLOSE BY CONSTRUCTION. `closeDisplay` is a settled value; an intraday "recap" would be a
 * forecast wearing a result's clothes. The router's sufficiency gate is what enforces this, and it
 * is the same reasoning as EM_CONE requiring a realised path.
 */

import type { ReactElement } from "react";
import { C, FONT, toneColor } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

/** Strip grouping separators and currency so a display string can be checked for a real number. */
function parseDisplay(v: string): number | null {
  const n = Number(
    String(v)
      .replace(/[^0-9.\-−]/g, "")
      .replace("−", "-"),
  );
  return Number.isFinite(n) ? n : null;
}

export function SessionRecapCard({
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
  const sess = bundle.session!;

  recorder.value("Session", sess.dateLabel, sess.source);
  recorder.value("Open", sess.openDisplay, sess.source);
  recorder.value("High", sess.highDisplay, sess.source);
  recorder.value("Low", sess.lowDisplay, sess.source);
  recorder.value("Close", sess.closeDisplay, sess.source);
  if (sess.changeDisplay) recorder.value("Change", sess.changeDisplay, sess.source);

  const o = parseDisplay(sess.openDisplay);
  const h = parseDisplay(sess.highDisplay);
  const l = parseDisplay(sess.lowDisplay);
  const c = parseDisplay(sess.closeDisplay);
  // All four, finite, and a non-degenerate range. Anything less and there is no honest geometry.
  const geometry = o != null && h != null && l != null && c != null && h > l ? { o, h, l, c, span: h - l } : null;
  if (!geometry) recorder.omit("session range bar");

  const dirColor = sess.changeDirection === "up" ? C.bull : sess.changeDirection === "down" ? C.bear : C.muted;
  const pct = (v: number) => ((v - geometry!.l) / geometry!.span) * 100;

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
        marginTop: s(20, spec),
      }}
    >
      <Kicker text={`Session recap · ${sess.dateLabel}`} spec={spec} color={C.info} />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          marginTop: s(10, spec),
        }}
      >
        <Headline text={sess.closeDisplay} spec={spec} />
        {sess.changeDisplay && (
          <div
            style={{
              display: "flex",
              fontFamily: FONT.display,
              fontSize: s(40, spec),
              color: dirColor,
              marginLeft: s(18, spec),
            }}
          >
            {sess.changeDisplay}
          </div>
        )}
      </div>
      {bundle.headline && (
        <div
          style={{
            display: "flex",
            fontFamily: FONT.mono,
            fontSize: s(19, spec),
            color: C.muted,
            marginTop: s(8, spec),
          }}
        >
          {bundle.headline}
        </div>
      )}
    </div>,

    geometry ? (
      <div
        key="bar"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          marginTop: s(26, spec),
        }}
      >
        {/* Low → high rail, with open and close marked in their true positions along it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            height: s(30, spec),
            background: "rgba(255,255,255,0.03)",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: `${Math.min(pct(geometry.o), pct(geometry.c))}%`,
              width: `${Math.max(1.2, Math.abs(pct(geometry.c) - pct(geometry.o)))}%`,
              height: "100%",
              background: dirColor,
              opacity: 0.55,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: `${pct(geometry.o)}%`,
              width: s(3, spec),
              height: "100%",
              background: C.muted,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: `${pct(geometry.c)}%`,
              width: s(4, spec),
              height: "100%",
              background: C.primary,
            }}
          />
        </div>
        <div style={{ display: "flex", width: "100%", marginTop: s(8, spec) }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(13, spec),
                letterSpacing: s(2, spec),
                color: C.faint,
              }}
            >
              LOW
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(19, spec),
                color: C.bear,
                marginTop: s(2, spec),
              }}
            >
              {sess.lowDisplay}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginLeft: "auto",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(13, spec),
                letterSpacing: s(2, spec),
                color: C.faint,
              }}
            >
              HIGH
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(19, spec),
                color: C.bull,
                marginTop: s(2, spec),
              }}
            >
              {sess.highDisplay}
            </div>
          </div>
        </div>
      </div>
    ) : (
      <div key="ohlc" style={{ display: "flex", width: "100%", marginTop: s(24, spec) }}>
        {[
          { label: "Open", value: sess.openDisplay },
          { label: "High", value: sess.highDisplay },
          { label: "Low", value: sess.lowDisplay },
          { label: "Close", value: sess.closeDisplay },
        ].map((t, i) => (
          <div
            key={t.label}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginLeft: i === 0 ? 0 : s(12, spec),
            }}
          >
            <Kicker text={t.label} spec={spec} />
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(24, spec),
                color: C.primary,
                marginTop: s(4, spec),
              }}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>
    ),

    // Open/close values always render, even with the bar present — the bar shows the RELATIONSHIP
    // and the numbers are the claim. One without the other is half a recap.
    geometry ? (
      <div key="oc" style={{ display: "flex", width: "100%", marginTop: s(16, spec) }}>
        {[
          { label: "Open", value: sess.openDisplay, color: C.muted },
          { label: "Close", value: sess.closeDisplay, color: C.primary },
          ...(sess.rangeDisplay ? [{ label: "Range", value: sess.rangeDisplay, color: C.info }] : []),
        ].map((t, i) => (
          <div
            key={t.label}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginLeft: i === 0 ? 0 : s(12, spec),
            }}
          >
            <Kicker text={t.label} spec={spec} />
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(26, spec),
                color: t.color,
                marginTop: s(4, spec),
              }}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>
    ) : null,

    sess.stats.length ? (
      <div key="stats" style={{ display: "flex", width: "100%", marginTop: s(20, spec) }}>
        {sess.stats.slice(0, 4).map((st, i) => {
          recorder.value(st.label, st.value, sess.source);
          return (
            <div
              key={st.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                marginLeft: i === 0 ? 0 : s(12, spec),
                padding: s(12, spec),
                background: "rgba(255,255,255,0.02)",
                borderLeft: `${s(3, spec)}px solid ${toneColor(st.tone)}`,
              }}
            >
              <Kicker text={st.label} spec={spec} />
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(24, spec),
                  color: toneColor(st.tone),
                  marginTop: s(5, spec),
                }}
              >
                {st.value}
              </div>
            </div>
          );
        })}
      </div>
    ) : null,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Settled session · post-close" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

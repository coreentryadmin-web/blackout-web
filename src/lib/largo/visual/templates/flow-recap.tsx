/**
 * FLOW RECAP — "what did the tape actually print?"
 *
 * THE SHAPE IS A TAPE, AND THAT IS THE POINT. Rows are individual prints in the order the tape
 * reported them, not a ranked best-of. A "biggest prints" leaderboard would be a different and
 * much weaker claim: the tape's argument is cumulative — many prints leaning one way — and
 * re-sorting by size destroys exactly the property being asserted.
 *
 * THE SPLIT BAR IS THE HEADLINE EVIDENCE. Net premium alone is famously misleading: −$8M net can
 * sit inside $400M gross (noise) or inside $12M gross (a one-sided tape). Drawing call-share
 * against gross is what separates those two cases at a glance, and it is why `callShare` is a
 * required field rather than something the card derives from the rows in view — the rows are a
 * SAMPLE of the tape and the share is measured over all of it.
 *
 * When `callShare` is absent the bar is omitted and the card still renders the net/gross pair.
 * A split bar drawn from the visible sample would be a different measurement wearing the same
 * shape, which is worse than no bar.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function FlowRecapCard({
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
  const flow = bundle.flow!;
  // Landscape is `dense` — the split bar and the two premium tiles above cost most of the canvas,
  // so the tape sheds rows rather than pushing the "showing N of M" line off under the footer.
  const rows = flow.rows.slice(0, spec.dense ? 4 : spec.stack ? 8 : 6);

  recorder.value("Net premium", flow.netDisplay, "HELIX");
  recorder.value("Gross premium", flow.grossDisplay, "HELIX");
  recorder.value("Prints", String(flow.printCount), "HELIX");

  const callPct = flow.callShare != null ? Math.round(flow.callShare * 100) : null;
  if (callPct != null) recorder.value("Call share of gross", `${callPct}%`, "HELIX");
  else recorder.omit("call/put split");

  const title = bundle.headline ?? `${bundle.ticker ?? "Options"} flow`;

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["HELIX"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div
      key="t"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: s(22, spec),
      }}
    >
      <Kicker text={`Premium tape · ${flow.windowLabel} · ${flow.printCount} prints`} spec={spec} color={C.info} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={title} spec={spec} />
      </div>
    </div>,

    <div key="tot" style={{ display: "flex", width: "100%", marginTop: s(20, spec) }}>
      {[
        { label: "Net premium", value: flow.netDisplay, accent: true },
        { label: "Gross premium", value: flow.grossDisplay, accent: false },
      ].map((t, i) => (
        <div
          key={t.label}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : s(14, spec),
            padding: s(14, spec),
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Kicker text={t.label} spec={spec} />
          <div
            style={{
              display: "flex",
              fontFamily: FONT.display,
              fontSize: s(46, spec),
              // Net carries a sign and therefore a direction; gross is a magnitude and stays
              // neutral, so the colour never implies a bias the number does not contain.
              color: t.accent ? (flow.netDisplay.startsWith("−") ? C.bear : C.bull) : C.primary,
              marginTop: s(6, spec),
            }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>,

    callPct != null ? (
      <div
        key="split"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          marginTop: s(18, spec),
        }}
      >
        <div style={{ display: "flex", width: "100%", height: s(18, spec) }}>
          <div
            style={{
              display: "flex",
              width: `${callPct}%`,
              height: "100%",
              background: C.bull,
            }}
          />
          <div
            style={{
              display: "flex",
              width: `${100 - callPct}%`,
              height: "100%",
              background: C.bear,
            }}
          />
        </div>
        <div style={{ display: "flex", width: "100%", marginTop: s(7, spec) }}>
          <div
            style={{
              display: "flex",
              fontFamily: FONT.mono,
              fontSize: s(15, spec),
              color: C.bull,
            }}
          >
            {`CALLS ${callPct}%`}
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              fontFamily: FONT.mono,
              fontSize: s(15, spec),
              color: C.bear,
            }}
          >
            {`PUTS ${100 - callPct}%`}
          </div>
        </div>
      </div>
    ) : null,

    <div
      key="rows"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop: s(18, spec),
      }}
    >
      {rows.map((r, i) => {
        const color = r.side === "call" ? C.bull : C.bear;
        recorder.value(`${r.ticker} ${r.side}`, r.premiumDisplay, "HELIX", r.at);
        return (
          <div
            key={`${r.ticker}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: `${s(8, spec)}px ${s(12, spec)}px`,
              marginTop: i === 0 ? 0 : s(5, spec),
              background: "rgba(255,255,255,0.015)",
              borderLeft: `${s(3, spec)}px solid ${color}`,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(20, spec),
                color: C.primary,
                width: s(86, spec),
                flexShrink: 0,
              }}
            >
              {r.ticker}
            </div>
            {/* Wide enough for "CALL" at this size WITH the letter-spacing applied — the first
                pass sized this off "PUT" and clipped every call row to "CALl". */}
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(16, spec),
                letterSpacing: s(1, spec),
                color,
                width: s(76, spec),
                flexShrink: 0,
              }}
            >
              {r.side.toUpperCase()}
            </div>
            {r.detail && (
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(15, spec),
                  color: C.muted,
                }}
              >
                {r.detail}
              </div>
            )}
            <div
              style={{
                display: "flex",
                marginLeft: "auto",
                alignItems: "center",
              }}
            >
              {r.at && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(14, spec),
                    color: C.faint,
                    marginRight: s(14, spec),
                  }}
                >
                  {r.at}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(19, spec),
                  color,
                }}
              >
                {r.premiumDisplay}
              </div>
            </div>
          </div>
        );
      })}
    </div>,

    // Says out loud that the rows are a window into a larger tape. Without it, six rows under a
    // "$412M gross" headline reads as though six prints made $412M.
    flow.printCount > rows.length ? (
      <div key="more" style={{ display: "flex", marginTop: s(12, spec) }}>
        <Kicker text={`Showing ${rows.length} of ${flow.printCount} prints · totals cover all of them`} spec={spec} />
      </div>
    ) : null,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Helix flow tape" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

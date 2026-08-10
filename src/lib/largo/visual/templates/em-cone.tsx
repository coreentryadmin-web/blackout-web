/**
 * EM_CONE — "did price stay inside the expected move?"
 *
 * NEW SHAPE: a band with an actual path drawn through it. Every other template states a condition;
 * this one states a PREDICTION and then scores it against what happened. That is a different kind
 * of claim and it needs a different geometry — a level ladder can show ±1σ as two rows, but it
 * cannot show whether price went outside and came back.
 *
 * THE SELF-SCORING PROPERTY IS THE POINT. The same card, published every close, is a public record
 * of a falsifiable claim the desk keeps making. That is worth more than any single win: it is the
 * only template in the library whose value compounds with repetition, and the only one where
 * posting a MISS is as useful as posting a hit.
 *
 * SO IT MUST NOT BE POSTABLE EARLY. `verdict` is derived from a realised path, and the sufficiency
 * predicate requires `path.length >= 2` — an intraday render would show a cone with a stub of path
 * in it and imply a result that has not happened. This is a post-close card by construction, not
 * by convention.
 *
 * BREACH AND CLOSE-OUTSIDE ARE DIFFERENT VERDICTS, and collapsing them would flatter the desk.
 * `held` = never left the band. `breached` = went outside and returned inside by the close.
 * `closed_outside` = ended beyond it. A card that reported only the close would hide every
 * intraday excursion — the same negative-skew tail the condor work already insists on reporting.
 *
 * The path is drawn as a column of positioned dots rather than an SVG polyline: satori has no
 * `<path>`, and a dot column is honest about sampling — it shows the observations, not an
 * interpolation between them.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

const VERDICT_LABEL: Record<string, string> = {
  held: "Held the band",
  breached: "Breached, recovered",
  closed_outside: "Closed outside",
};

export function EmConeCard({
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
  const cone = bundle.cone!;
  const verdictColor = cone.verdict === "held" ? C.bull : cone.verdict === "breached" ? C.warn : C.bear;

  // Chart bounds are the WIDER of the band and the realised path, so an excursion outside the
  // band is visibly outside rather than clipped to the edge — clipping would erase the finding.
  const prices = cone.path.map((p) => p.price);
  const hi = Math.max(cone.upper, ...prices);
  const lo = Math.min(cone.lower, ...prices);
  const span = hi - lo || 1;
  const pctFromTop = (v: number) => ((hi - v) / span) * 100;

  const plotH = spec.stack ? s(300, spec) : s(210, spec);

  recorder.value("Expected move upper", cone.upperDisplay, "VECTOR", cone.asOf);
  recorder.value("Expected move lower", cone.lowerDisplay, "VECTOR", cone.asOf);
  recorder.value("Open", cone.openDisplay, "VECTOR");
  recorder.value("Close", cone.closeDisplay, "VECTOR");
  recorder.value("Verdict", VERDICT_LABEL[cone.verdict] ?? cone.verdict, "VECTOR");

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["VECTOR", "THERMAL"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(22, spec) }}>
      <Kicker text={`${bundle.ticker ?? ""} · expected move ${cone.sigmaLabel}`.trim()} spec={spec} color={C.info} />
      <div style={{ display: "flex", marginTop: s(8, spec) }}>
        <Headline text={VERDICT_LABEL[cone.verdict] ?? cone.verdict} spec={spec} color={verdictColor} />
      </div>
    </div>,

    // ── The band + path ──
    <div key="plot" style={{ display: "flex", position: "relative", width: "100%", height: plotH, marginTop: s(20, spec) }}>
      {/* Band fill, positioned by price so the cone's width is the real one. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          right: 0,
          top: `${pctFromTop(cone.upper)}%`,
          height: `${((cone.upper - cone.lower) / span) * 100}%`,
          background: "rgba(34,211,238,0.10)",
          borderTop: `${s(2, spec)}px solid ${C.info}`,
          borderBottom: `${s(2, spec)}px solid ${C.info}`,
        }}
      />
      {/* Realised path — one dot per observation. */}
      {cone.path.map((p, i) => {
        const outside = p.price > cone.upper || p.price < cone.lower;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              position: "absolute",
              left: `${(i / Math.max(1, cone.path.length - 1)) * 98}%`,
              top: `${pctFromTop(p.price)}%`,
              width: s(6, spec),
              height: s(6, spec),
              borderRadius: s(3, spec),
              // An excursion is coloured as a breach at the point it happens, so the eye lands on
              // the moment rather than on the summary.
              background: outside ? C.bear : C.primary,
            }}
          />
        );
      })}
      {/* Band labels ride at the band edges. */}
      <div style={{ display: "flex", position: "absolute", right: 0, top: `${pctFromTop(cone.upper)}%`, fontFamily: FONT.mono, fontSize: s(15, spec), color: C.info }}>
        {cone.upperDisplay}
      </div>
      <div style={{ display: "flex", position: "absolute", right: 0, top: `${pctFromTop(cone.lower)}%`, fontFamily: FONT.mono, fontSize: s(15, spec), color: C.info }}>
        {cone.lowerDisplay}
      </div>
    </div>,

    <div key="m" style={{ display: "flex", width: "100%", marginTop: s(20, spec) }}>
      {[
        { label: "Open", value: cone.openDisplay, color: C.muted },
        { label: "Close", value: cone.closeDisplay, color: verdictColor },
        { label: "Band width", value: cone.widthDisplay, color: C.info },
      ].map((m, i) => (
        <div key={m.label} style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: i === 0 ? 0 : s(14, spec) }}>
          <Kicker text={m.label} spec={spec} />
          <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(26, spec), color: m.color, marginTop: s(5, spec) }}>
            {m.value}
          </div>
        </div>
      ))}
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Vector expected move · options-implied" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

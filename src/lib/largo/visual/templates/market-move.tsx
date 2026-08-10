/**
 * MARKET_MOVE — "why did SPX dump?"
 *
 * The question is causal, so the card's job is to put the CONCLUSION next to the MEASUREMENTS that
 * support it and let a reader check the reasoning at a glance. Hierarchy, top to bottom:
 * provenance chrome → headline conclusion → hero spot → supporting metrics → dealer level context
 * → which systems saw what → attribution + freshness + disclaimer.
 *
 * Largo's own verdict is reused VERBATIM as the headline. Re-generating a punchier line for the
 * graphic would let the image claim something the answer did not, which is the exact failure the
 * one-snapshot rule exists to prevent — and it would do it on the surface least able to be checked.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, GexBars, Headline, HeroNumber, Kicker, LevelMap, MetricRow, SystemStrip } from "../primitives";

export function MarketMoveCard({
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
  const biasColor = bundle.bias === "bull" ? C.bull : bundle.bias === "bear" ? C.bear : C.primary;

  // On tall surfaces the spot/metrics pair stacks; on landscape they share a row. Laying out
  // differently per aspect is what keeps a story from looking like a squashed landscape card.
  const heroRow = (
    <div
      style={{
        display: "flex",
        flexDirection: spec.stack ? "column" : "row",
        alignItems: spec.stack ? "flex-start" : "flex-end",
        width: "100%",
        marginTop: s(22, spec),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <HeroNumber n={bundle.spot} label={bundle.ticker ? `${bundle.ticker} spot` : "Spot"} spec={spec} recorder={recorder} />
      </div>
      {bundle.regime && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: spec.stack ? 0 : "auto",
            marginTop: spec.stack ? s(20, spec) : 0,
            alignItems: spec.stack ? "flex-start" : "flex-end",
          }}
        >
          <Kicker text="Dealer regime" spec={spec} />
          <div
            style={{
              display: "flex",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: s(34, spec),
              color: C.warn,
              marginTop: s(6, spec),
            }}
          >
            {bundle.regime.label}
          </div>
        </div>
      )}
    </div>
  );

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="head"
      systems={bundle.systemsQueried.filter((x) => x !== "LARGO")}
      asOfLabel={asOfLabel}
      freshness={bundle.freshness}
      spec={spec}
    />,
    <div key="hl" style={{ display: "flex", flexDirection: "column", marginTop: s(26, spec) }}>
      {bundle.headline ? <Headline text={bundle.headline} spec={spec} color={biasColor} /> : <div style={{ display: "flex" }} />}
      {bundle.summary && (
        <div
          style={{
            display: "flex",
            fontFamily: FONT.mono,
            fontSize: s(20, spec),
            color: C.muted,
            marginTop: s(14, spec),
            lineHeight: 1.5,
          }}
        >
          {bundle.summary}
        </div>
      )}
    </div>,
    heroRow,
    <div key="m" style={{ display: "flex", width: "100%", marginTop: s(26, spec) }}>
      <MetricRow metrics={bundle.metrics} spec={spec} recorder={recorder} max={spec.stack ? 2 : 3} />
    </div>,
    // The level map answers "where is price relative to the structure", which is usually the real
    // content of a "why did it move" question. GEX shifts take its place when the move was
    // specifically a positioning change and the shift table is present.
    bundle.gexShifts?.length ? (
      <div key="g" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(26, spec) }}>
        <Kicker text="Dealer gamma change by strike" spec={spec} />
        <div style={{ display: "flex", width: "100%", marginTop: s(12, spec) }}>
          <GexBars shifts={bundle.gexShifts} spec={spec} recorder={recorder} max={spec.stack ? 4 : 3} />
        </div>
      </div>
    ) : (
      <div key="l" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(26, spec) }}>
        <Kicker text="Dealer levels" spec={spec} />
        <div style={{ display: "flex", width: "100%", marginTop: s(12, spec) }}>
          <LevelMap levels={bundle.levels} spot={bundle.spot} spec={spec} recorder={recorder} max={spec.stack ? 5 : 3} />
        </div>
      </div>
    ),
    <div key="spacer" style={{ display: "flex", flex: 1 }} />,
    // The system strip is the first thing shed on a dense surface: the footer already carries
    // attribution, so dropping it costs detail rather than provenance.
    !spec.dense && bundle.systemReads?.length ? (
      <div key="sys" style={{ display: "flex", width: "100%", marginBottom: s(18, spec) }}>
        <SystemStrip reads={bundle.systemReads} spec={spec} recorder={recorder} />
      </div>
    ) : null,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution={bundle.systemsQueried.join(" · ")} spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

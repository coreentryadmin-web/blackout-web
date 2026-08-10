/**
 * TRADE_RECAP — "how did Slayer catch today's move?"
 *
 * The most dangerous template in the library, so it carries the strictest rules.
 *
 * A trade recap is a PERFORMANCE CLAIM. Posted publicly it is the thing a prospective member
 * judges the product on, and it is the thing a regulator would read most carefully. Two guards,
 * both enforced here rather than left to whoever composes the post:
 *
 *   1. AN UNGRADED ROW IS NEVER SHOWN AS A RESULT. `PnlBlock` labels itself from the row's own
 *      `graded` flag — a booked return says "Booked return", an open position says "Live
 *      mark-to-market" and carries an explicit "position open · not a booked result" line. This is
 *      the marketing-surface application of the live P0 record-honesty finding, where today's
 *      closed-but-ungraded rows are precisely the ones a recap would most want to claim.
 *
 *   2. THE LIFECYCLE IS BUILT FROM REAL TIMESTAMPS ONLY. `timelineFromLedgerRow` drops any step
 *      whose stamp does not parse, so a card can show a two-step lifecycle but never an invented
 *      one. A fabricated entry time on a performance graphic would be indefensible.
 *
 * Hierarchy: chrome → ticker + direction → return (the number people came for) → lifecycle with
 * timestamps → entry/exit/contract detail → attribution + disclaimer.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Kicker, PnlBlock, Timeline } from "../primitives";

export function TradeRecapCard({
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
  const t = bundle.trade!;
  const longSide = t.direction === "long";
  const dirColor = longSide ? C.bull : C.bear;

  recorder.value("Ticker", t.ticker, t.source);
  recorder.value("Direction", t.direction.toUpperCase(), t.source);
  if (t.contract) recorder.value("Contract", t.contract, t.source);
  if (t.status) recorder.value("Status", t.status, t.source);

  const detailPair = (label: string, value: string | null | undefined, color: string) => {
    if (!value) {
      recorder.omit(label.toLowerCase());
      return null;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Kicker text={label} spec={spec} />
        <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(30, spec), color, marginTop: s(6, spec) }}>
          {value}
        </div>
      </div>
    );
  };

  if (t.entry) recorder.value("Entry premium", t.entry.display, t.entry.source, t.entry.asOf);
  if (t.exit) recorder.value(t.graded ? "Exit premium" : "Last mark", t.exit.display, t.exit.source, t.exit.asOf);

  const children: (ReactElement | null)[] = [
    <CardHeader key="head" systems={[t.source]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    // Ticker + direction. The direction chip is filled rather than outlined because on a recap the
    // side is as load-bearing as the ticker itself.
    <div key="id" style={{ display: "flex", alignItems: "center", marginTop: s(24, spec) }}>
      <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(70, spec), color: C.primary, lineHeight: 1 }}>
        {t.ticker}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: s(18, spec),
          letterSpacing: s(3, spec),
          color: C.void,
          background: dirColor,
          padding: `${s(7, spec)}px ${s(13, spec)}px`,
          marginLeft: s(18, spec),
        }}
      >
        {t.direction.toUpperCase()}
      </div>
      {t.contract && (
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(19, spec), color: C.muted, marginLeft: s(18, spec) }}>
          {t.contract}
        </div>
      )}
    </div>,

    // The return, and its honesty label.
    <div key="pnl" style={{ display: "flex", marginTop: s(24, spec) }}>
      <PnlBlock returnPct={t.returnPct} graded={t.graded} spec={spec} recorder={recorder} />
      {t.peakReturnPct && (
        <div style={{ display: "flex", flexDirection: "column", marginLeft: s(56, spec), justifyContent: "flex-end" }}>
          <Kicker text="Peak" spec={spec} />
          <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(40, spec), color: C.bull, marginTop: s(6, spec) }}>
            {t.peakReturnPct.display}
          </div>
        </div>
      )}
    </div>,

    // Lifecycle. Omitted entirely rather than shown with gaps when stamps are missing.
    bundle.timeline?.length ? (
      <div key="tl" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(28, spec) }}>
        <Kicker text="Lifecycle" spec={spec} />
        <div style={{ display: "flex", width: "100%", marginTop: s(14, spec) }}>
          <Timeline steps={bundle.timeline} spec={spec} recorder={recorder} />
        </div>
      </div>
    ) : null,

    <div key="detail" style={{ display: "flex", width: "100%", marginTop: s(20, spec) }}>
      {detailPair("Entry", t.entry?.display, C.primary)}
      {detailPair(t.graded ? "Exit" : "Last mark", t.exit?.display, t.graded ? C.primary : C.warn)}
      {detailPair("Status", t.status ?? null, t.graded ? C.bull : C.warn)}
    </div>,

  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution={`${t.source} ledger`} spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

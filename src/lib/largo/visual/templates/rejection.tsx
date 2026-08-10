/**
 * REJECTION — "what did the engine pass on, and which gate stopped it?"
 *
 * NEW SHAPE: a gate trace. Every other template in the library describes something the desk DID.
 * This one describes what it DIDN'T do and why, which no existing layout can express — a trade
 * recap with a "no trade" outcome is not the same artefact, because the content here is the GATE,
 * not the instrument.
 *
 * WHY THIS IS THE MOST VALUABLE CARD IN THE LIBRARY, AND THE MOST DANGEROUS. Nobody in this space
 * publishes their misses, so a card naming the exact gate that blocked a name is credibility no
 * win screenshot can buy. It is dangerous for the mirror-image reason: publishing ONLY the
 * rejections that later looked smart is survivorship bias with an audit trail bolted on, which is
 * worse than not publishing at all because it wears the costume of transparency.
 *
 * SO THE TEMPLATE REFUSES TO CHERRY-PICK. It renders the most recent N rejections in the order the
 * log produced them, and states the window it covers. It does NOT rank by "how bad the trade would
 * have been" and it does not accept a caller-supplied subset — see the sufficiency predicate,
 * which requires the rows to carry their own gate codes. If a future caller wants a curated set,
 * that is a different template and it should have to say so in its name.
 *
 * A GATE WITH NO NAME IS NOT A REJECTION ROW. `gateFailed` is required per row: "we passed" with no
 * reason is an assertion of judgement rather than a record of a rule, and the whole point of the
 * card is that a rule fired.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function RejectionCard({
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
  const rej = bundle.rejections!;
  const rows = rej.rows.slice(0, spec.stack ? 7 : 5);

  recorder.value("Rejections in window", String(rej.total), "0DTE");
  if (rej.windowLabel) recorder.value("Window", rej.windowLabel, "0DTE");

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["0DTE", "NIGHT HAWK"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(24, spec) }}>
      <Kicker text="What the engine passed on" spec={spec} color={C.warn} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={`${rej.total} setups held`} spec={spec} color={C.warn} />
      </div>
      <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(17, spec), color: C.muted, marginTop: s(10, spec) }}>
        {/* States the window so nobody reads N rows as "everything we rejected". */}
        {rej.windowLabel ? `Gate-rejection log · ${rej.windowLabel}` : "Gate-rejection log"}
      </div>
    </div>,

    <div key="rows" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(22, spec) }}>
      {rows.map((r, i) => {
        recorder.value(`${r.ticker} gate`, r.gateFailed, "0DTE");
        return (
          <div
            key={`${r.ticker}-${i}`}
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              padding: `${s(10, spec)}px ${s(12, spec)}px`,
              marginTop: i === 0 ? 0 : s(6, spec),
              background: "rgba(255,255,255,0.015)",
              borderLeft: `${s(3, spec)}px solid ${C.warn}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", width: "100%" }}>
              <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(21, spec), color: C.primary, width: s(96, spec) }}>
                {r.ticker}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(14, spec),
                  letterSpacing: s(2, spec),
                  textTransform: "uppercase",
                  color: C.warn,
                }}
              >
                {r.gateFailed}
              </div>
              {r.at && (
                <div style={{ display: "flex", marginLeft: "auto", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.faint }}>
                  {r.at}
                </div>
              )}
            </div>
            {r.reason && (
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.muted, marginTop: s(4, spec) }}>
                {r.reason}
              </div>
            )}
          </div>
        );
      })}
    </div>,

    <div key="note" style={{ display: "flex", marginTop: s(16, spec) }}>
      {/* The honest framing. A held setup is not a proven save — it is a rule doing its job. */}
      <Kicker text="Every setup the gates held — not a claim each would have lost" spec={spec} />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="0DTE gate log" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

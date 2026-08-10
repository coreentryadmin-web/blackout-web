/**
 * COUNTERFACTUAL — what the firewall HELD, graded on real bars.
 *
 * THIS IS THE ONE CARD IN THE LIBRARY NOBODY ELSE CAN PUBLISH, and the reason is structural rather
 * than clever: producing it requires (a) a rules engine that logs every refusal with the specific
 * gate that fired, and (b) grading the trades you did NOT take, on real minute bars, after the
 * fact. Anyone can post what they caught. `firewall-rth-replay.mjs` already computes exactly this
 * — OLD (guards off) vs NEW (Phase-0 firewall), diffed and graded — and it has never had a way to
 * reach a member.
 *
 * BOTH SIDES ARE REQUIRED FIELDS AND BOTH ARE RENDERED AT EQUAL WEIGHT.
 *
 * A card reporting losers-avoided without winners-forgone is a highlight reel of a guard, and it
 * would be worse than not shipping this at all: the forgone side IS the guard's cost, and a
 * fail-closed rule that never costs anything is a rule that never fires. So the two columns are
 * symmetric — same size, same treatment — and the NET is stated underneath as the only number that
 * settles whether the guard paid.
 *
 * NET IS COLOURED BY WHAT IT MEANS FOR THE MEMBER, NOT BY ITS SIGN. A positive net here means the
 * guard SAVED money, which is a good outcome and reads green; a negative net means it cost money,
 * which reads red. That is the same direction convention the P&L block uses, and stating it here
 * because the underlying quantity is a difference of two P&Ls and the sign is easy to invert.
 *
 * `gradedCount` IS SEPARATE FROM `heldCount` and rendered. Not every held play can be graded (no
 * bars, no probed contract), and quietly grading a subset while reporting the full hold count is
 * how a counterfactual becomes fiction.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

type CfRow = NonNullable<VisualBundle["counterfactual"]>["rows"][number];

/**
 * Take up to `limit` rows WITHOUT letting truncation empty one side.
 *
 * A plain `.slice(0, limit)` produced exactly the failure this card is built to prevent: with the
 * rows in avoided-then-forgone order, the landscape cap of four kept three avoided rows and one
 * forgone, then the next render dropped the forgone side entirely — a card headed "the guard paid"
 * listing nothing but wins for the guard. The truncation, not the data, made it a highlight reel.
 *
 * So the budget is split evenly and each side keeps its own order; a side with fewer rows than its
 * half donates the remainder to the other rather than wasting it.
 */
export function balancedRows(rows: CfRow[], limit: number): CfRow[] {
  const avoided = rows.filter((r) => r.verdict === "avoided");
  const forgone = rows.filter((r) => r.verdict === "forgone");
  const half = Math.floor(limit / 2);
  const takeA = Math.min(avoided.length, Math.max(half, limit - forgone.length));
  const takeF = Math.min(forgone.length, limit - takeA);
  // Interleaved so the two sides alternate down the card and neither reads as the primary list.
  const a = avoided.slice(0, takeA);
  const f = forgone.slice(0, takeF);
  const out: CfRow[] = [];
  for (let i = 0; i < Math.max(a.length, f.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (f[i]) out.push(f[i]!);
  }
  return out;
}

export function CounterfactualCard({
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
  const cf = bundle.counterfactual!;
  const rows = balancedRows(cf.rows, spec.dense ? 2 : spec.stack ? 8 : 6);

  recorder.value("Guard", cf.guardLabel, cf.source);
  recorder.value("Plays held", String(cf.heldCount), cf.source);
  recorder.value("Held plays graded", String(cf.gradedCount), cf.source);
  recorder.value("Losers avoided", cf.losersAvoided.pnlDisplay, cf.source);
  recorder.value("Winners forgone", cf.winnersForgone.pnlDisplay, cf.source);
  recorder.value("Net effect", cf.netDisplay, cf.source);

  const netColor = cf.netValue > 0 ? C.bull : cf.netValue < 0 ? C.bear : C.muted;
  const netVerdict = cf.netValue > 0 ? "the guard paid" : cf.netValue < 0 ? "the guard cost" : "net flat";

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["NIGHT HAWK"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(20, spec) }}>
      {/* The guard name moved OFF the kicker: with a session label in front of it the line ran
          past the card edge and clipped mid-word. It belongs on the sub-line anyway — it is the
          card's subject, not its category. */}
      <Kicker text={`Counterfactual · ${cf.sessionLabel}`} spec={spec} color={C.ai} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={bundle.headline ?? `${cf.heldCount} plays the rules held`} spec={spec} />
      </div>
      <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(17, spec), color: C.muted, marginTop: s(8, spec) }}>
        {`${cf.guardLabel} · ${cf.gradedCount} of ${cf.heldCount} graded on real minute bars`}
      </div>
    </div>,

    // The symmetric pair. Equal width, equal type scale, no visual precedence — the layout is the
    // honesty mechanism, not the copy.
    <div key="pair" style={{ display: "flex", width: "100%", marginTop: s(22, spec) }}>
      {[
        {
          label: "Losers avoided",
          count: cf.losersAvoided.count,
          value: cf.losersAvoided.pnlDisplay,
          color: C.bull,
          sub: "would have lost",
        },
        {
          label: "Winners forgone",
          count: cf.winnersForgone.count,
          value: cf.winnersForgone.pnlDisplay,
          color: C.bear,
          sub: "would have won",
        },
      ].map((side, i) => (
        <div
          key={side.label}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : s(16, spec),
            padding: s(16, spec),
            background: "rgba(255,255,255,0.02)",
            borderTop: `${s(3, spec)}px solid ${side.color}`,
          }}
        >
          <Kicker text={`${side.label} · ${side.count}`} spec={spec} />
          <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(46, spec), color: side.color, marginTop: s(6, spec), lineHeight: 1 }}>
            {side.value}
          </div>
          <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(14, spec), color: C.faint, marginTop: s(6, spec) }}>
            {side.sub}
          </div>
        </div>
      ))}
    </div>,

    <div
      key="net"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        marginTop: s(16, spec),
        padding: s(14, spec),
        background: "rgba(255,255,255,0.02)",
        borderLeft: `${s(3, spec)}px solid ${netColor}`,
      }}
    >
      <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(17, spec), letterSpacing: s(2, spec), textTransform: "uppercase", color: C.faint }}>
        {`Net · ${netVerdict}`}
      </div>
      <div style={{ display: "flex", marginLeft: "auto", fontFamily: FONT.display, fontSize: s(38, spec), color: netColor }}>
        {cf.netDisplay}
      </div>
    </div>,

    rows.length ? (
      <div key="rows" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(16, spec) }}>
        {rows.map((r, i) => {
          const color = r.verdict === "avoided" ? C.bull : C.bear;
          recorder.value(`${r.ticker} held by ${r.gate}`, r.outcomeDisplay, cf.source);
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
              <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(19, spec), color: C.primary, width: s(96, spec), flexShrink: 0 }}>
                {r.ticker}
              </div>
              {/* The gate name is the whole point of the row — this is a card about a RULE. */}
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color: C.warn }}>{r.gate}</div>
              <div
                style={{
                  display: "flex",
                  marginLeft: "auto",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(19, spec),
                  color,
                }}
              >
                {r.outcomeDisplay}
              </div>
            </div>
          );
        })}
      </div>
    ) : null,

    <div key="note" style={{ display: "flex", marginTop: s(12, spec) }}>
      <Kicker
        text={
          rows.length < cf.gradedCount
            ? `Showing ${rows.length} of ${cf.gradedCount} graded holds, balanced across both sides · totals cover all ${cf.gradedCount}`
            : "Held plays graded on the session's real minute bars"
        }
        spec={spec}
      />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Fail-closed guard · replayed and graded" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

/**
 * GRADER AGREEMENT — two grading LANES, measured against each other.
 *
 * THE SECOND CARD NOBODY ELSE CAN PUBLISH, for the same structural reason as COUNTERFACTUAL: it
 * requires two ways of grading the same trade that can disagree. Most platforms have one, which
 * cannot be audited by anything except itself.
 *
 * "LANES", NOT "INDEPENDENT GRADERS" — the wording was corrected when the serving path was built.
 * `feature-store.ts`'s `labelFromPlanOutcome` and `record.ts`'s `isZeroDteWin` were once two
 * implementations; `labelFromPlanOutcome` now DELEGATES to `isZeroDteWin` ("the shared source of
 * truth, not a hand copy"), so calling them independent would be false today. What is still real,
 * and is what the measurement compares, is the MID (mechanical) grade against the OFFICIAL
 * (executable / as-executed) one.
 * `outcome-grading-audit.mjs` already imports both real production functions live and flags every
 * disagreement; it has never had a way to reach a member.
 *
 * THE DISAGREEMENTS ARE ENUMERATED, NOT SUMMARISED, and that is what makes the headline number
 * mean anything. "96.9% agreement" with no visible exceptions is unfalsifiable — the reader has to
 * take the denominator, the definition and the arithmetic entirely on trust. Printing the four
 * rows that disagree, with BOTH verdicts side by side, converts the claim into something a
 * sceptical reader can argue with. That is the whole value of the card.
 *
 * TWO DENOMINATORS, BOTH RENDERED. `comparable` (rows carrying evidence on both sides) is the only
 * population that can test the invariant; `totalPlays` is the window. Reporting the agreement rate
 * against the larger number would inflate it, and reporting only the smaller one hides how narrow
 * the tested slice is. Both are on the card, with `populationLabel` saying in words what
 * `comparable` actually selects — a reader cannot check a bare fraction.
 *
 * DISAGREEMENT IS NOT FAILURE, and the card must not imply it is. Two graders reading a partially
 * banked trim differently is a real methodological difference, not a bug; the amber treatment says
 * "these need a human", not "these are wrong".
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function GraderAgreementCard({
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
  const ga = bundle.graderAgreement!;
  const disagreements = ga.comparable - ga.agreed;
  const rows = ga.rows.slice(0, spec.dense ? 4 : spec.stack ? 8 : 6);

  recorder.value("Agreement", ga.agreementDisplay, ga.source);
  recorder.value("Comparable rows", String(ga.comparable), ga.source);
  recorder.value("Agreed", String(ga.agreed), ga.source);
  recorder.value("Plays in window", String(ga.totalPlays), ga.source);

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["NIGHT HAWK"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(20, spec) }}>
      <Kicker text={`Grader cross-check · ${ga.windowLabel}`} spec={spec} color={C.ai} />
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: s(10, spec) }}>
        <Headline text={ga.agreementDisplay} spec={spec} color={C.info} />
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(22, spec), color: C.muted, marginLeft: s(16, spec), marginBottom: s(8, spec) }}>
          {`${ga.agreed} / ${ga.comparable} agree`}
        </div>
      </div>
      {/* The denominator, in words. Without it the percentage is not checkable. */}
      <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(16, spec), color: C.faint, marginTop: s(8, spec) }}>
        {`${ga.populationLabel} · ${ga.comparable} of ${ga.totalPlays} plays in the window can be tested`}
      </div>
    </div>,

    <div key="who" style={{ display: "flex", width: "100%", marginTop: s(20, spec) }}>
      {[
        { label: "Grader A", value: ga.graderALabel },
        { label: "Grader B", value: ga.graderBLabel },
      ].map((g, i) => (
        <div
          key={g.label}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : s(14, spec),
            padding: s(12, spec),
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Kicker text={g.label} spec={spec} />
          <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(19, spec), color: C.primary, marginTop: s(5, spec) }}>
            {g.value}
          </div>
        </div>
      ))}
    </div>,

    disagreements > 0 ? (
      <div key="dis" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(18, spec) }}>
        <Kicker text={`${disagreements} disagreement${disagreements === 1 ? "" : "s"} — every one of them`} spec={spec} color={C.warn} />
        <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(8, spec) }}>
          {rows.map((r, i) => {
            recorder.value(`${r.ticker} A`, r.a, ga.source);
            recorder.value(`${r.ticker} B`, r.b, ga.source);
            return (
              <div
                key={`${r.ticker}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: `${s(9, spec)}px ${s(12, spec)}px`,
                  marginTop: i === 0 ? 0 : s(5, spec),
                  background: "rgba(255,255,255,0.015)",
                  // Amber, not red: a methodological difference needing a human, not a defect.
                  borderLeft: `${s(3, spec)}px solid ${C.warn}`,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", width: s(150, spec), flexShrink: 0 }}>
                  <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(19, spec), color: C.primary }}>
                    {r.ticker}
                  </div>
                  {r.dateLabel && (
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(13, spec), color: C.faint, marginTop: s(2, spec) }}>
                      {r.dateLabel}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flex: 1, fontFamily: FONT.mono, fontSize: s(17, spec), color: C.muted }}>{r.a}</div>
                <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color: C.faint, marginLeft: s(8, spec), marginRight: s(8, spec) }}>
                  vs
                </div>
                <div style={{ display: "flex", flex: 1, fontFamily: FONT.mono, fontSize: s(17, spec), color: C.primary }}>{r.b}</div>
              </div>
            );
          })}
        </div>
        {rows.length < disagreements && (
          <div style={{ display: "flex", marginTop: s(8, spec) }}>
            <Kicker text={`Showing ${rows.length} of ${disagreements} — the rest are in the audit log`} spec={spec} />
          </div>
        )}
      </div>
    ) : (
      <div key="none" style={{ display: "flex", marginTop: s(20, spec) }}>
        <Kicker text="No disagreements in this window" spec={spec} color={C.bull} />
      </div>
    ),
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Two grading lanes · every exception listed" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

/**
 * SYSTEM COMPARISON — "do the products agree?"
 *
 * THE VERDICT IS COMPUTED, NOT ASSERTED. The card counts directional reads and states AGREEMENT /
 * SPLIT / DIVIDED from that count. Letting the caller pass a verdict string would make the
 * headline an opinion sitting above evidence that might contradict it — the one arrangement this
 * card must never produce, because its entire purpose is to show a disagreement honestly.
 *
 * NEUTRAL, NO-READ AND REGIME ARE NOT VOTES. Only `bullish` and `bearish` count toward the tally.
 * `regime` is a CONDITION (Thermal saying "negative gamma" is not a direction), `no-read` is an
 * absence, and `neutral` is a measured non-direction. Folding any of them into a majority would
 * manufacture consensus out of silence — the same rule `system-reads.ts` applies in the answer
 * layer, so the card and the prose reach the same verdict from the same reads.
 *
 * DISAGREEMENT IS THE INTERESTING OUTPUT, so the split case gets amber rather than being softened.
 * A card that only looked good when the systems agreed would be a card nobody could trust when
 * they did.
 */

import type { ReactElement } from "react";
import { C, FONT, GLYPH, stanceColor } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle, VisualSystemRead } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export type ConsensusVerdict = {
  label: "AGREEMENT" | "SPLIT" | "DIVIDED";
  color: string;
  detail: string;
};

/**
 * Tally directional reads into a verdict. Exported and pure so the rule is unit-testable rather
 * than buried in a render tree.
 */
export function consensusOf(reads: VisualSystemRead[]): ConsensusVerdict {
  const bulls = reads.filter((r) => r.stance === "bullish").length;
  const bears = reads.filter((r) => r.stance === "bearish").length;
  const abstain = reads.length - bulls - bears;

  if (bulls > 0 && bears > 0) {
    // A genuine contradiction between two measuring systems.
    return {
      label: "DIVIDED",
      color: C.warn,
      detail: `${bulls} bullish vs ${bears} bearish${abstain ? ` · ${abstain} no directional read` : ""}`,
    };
  }
  if (bulls + bears === 0) {
    return {
      label: "SPLIT",
      color: C.muted,
      detail: `no system took a direction · ${abstain} regime or neutral`,
    };
  }
  // One-sided among those that took a side. `abstain` is still reported, because "3 of 4 agree"
  // and "3 of 3 agree, 1 silent" are different claims.
  const side = bulls > 0 ? "bullish" : "bearish";
  return {
    label: abstain > 0 ? "SPLIT" : "AGREEMENT",
    color: abstain > 0 ? C.info : bulls > 0 ? C.bull : C.bear,
    detail: `${bulls + bears} ${side}${abstain ? ` · ${abstain} no directional read` : ""}`,
  };
}

export function SystemComparisonCard({
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
  const reads = (bundle.systemReads ?? []).slice(0, 5);
  const verdict = consensusOf(reads);

  recorder.value("Consensus", verdict.label, "LARGO");
  recorder.value("Tally", verdict.detail, "LARGO");

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="h"
      systems={reads.map((r) => r.system)}
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
      <Kicker text={`${reads.length} systems${bundle.ticker ? ` · ${bundle.ticker}` : ""}`} spec={spec} color={C.ai} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={verdict.label} spec={spec} color={verdict.color} />
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontSize: s(19, spec),
          color: C.muted,
          marginTop: s(8, spec),
        }}
      >
        {verdict.detail}
      </div>
    </div>,

    // One column per system: full-height so no read is visually subordinate to another. The
    // question is "who says what", and a ranked list would imply a hierarchy that does not exist.
    <div key="cols" style={{ display: "flex", width: "100%", marginTop: s(26, spec) }}>
      {reads.map((r, i) => {
        const color = stanceColor(r.stance);
        const glyph =
          r.stance === "bullish"
            ? GLYPH.up
            : r.stance === "bearish"
              ? GLYPH.down
              : r.stance === "regime"
                ? GLYPH.regime
                : GLYPH.none;
        if (r.detail) recorder.value(`${r.system}`, r.detail, r.system);
        return (
          <div
            key={r.system}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginLeft: i === 0 ? 0 : s(12, spec),
              padding: s(16, spec),
              background: "rgba(255,255,255,0.02)",
              borderTop: `${s(3, spec)}px solid ${color}`,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(14, spec),
                letterSpacing: s(2, spec),
                color: C.faint,
              }}
            >
              {r.system}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.display,
                fontSize: s(52, spec),
                color,
                marginTop: s(12, spec),
                lineHeight: 1,
              }}
            >
              {glyph}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(17, spec),
                letterSpacing: s(1, spec),
                textTransform: "uppercase",
                color,
                marginTop: s(10, spec),
              }}
            >
              {r.stance === "no-read" ? "NO READ" : r.stance}
            </div>
            {r.detail && (
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(15, spec),
                  color: C.muted,
                  marginTop: s(8, spec),
                }}
              >
                {r.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>,

    <div key="rule" style={{ display: "flex", marginTop: s(20, spec) }}>
      {/* Stated on the card, because a reader who does not know the counting rule cannot check
          the verdict — and an unfalsifiable verdict is not evidence. */}
      <Kicker text="Regime and neutral reads are not counted as votes" spec={spec} />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Cross-system consensus" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

/**
 * GAMMA MAP — "where is dealer gamma concentrated right now?"
 *
 * NOT A DUPLICATE OF LEVEL_ANALYSIS, AND NOT A DUPLICATE OF THE GEX BARS IN MARKET_MOVE.
 *   - LEVEL_ANALYSIS draws NAMED levels (call wall, flip, put wall) as a ladder — four rows, each
 *     a labelled claim about one price.
 *   - `gexShifts` / `GexBars` draw how gamma CHANGED at a handful of strikes — a delta.
 *   - This card draws the standing DISTRIBUTION: every strike in the band, positive gamma to the
 *     right of the flip axis and negative to the left, so the shape of the book is the content.
 *
 * A profile is the one gamma view where the SHAPE carries the argument — "gamma is stacked hard at
 * 7800 and thin below spot" is a sentence about a picture, and no ladder of four named levels can
 * make it.
 *
 * CENTRED ON THE FLIP, NOT ON ZERO. Bars grow left (negative) or right (positive) from a single
 * axis drawn at the flip strike, because the flip is the sign boundary the profile is *about*.
 * When no flip strike is supplied the axis is still drawn — as the zero line — and the card says
 * so rather than implying a flip that was never measured.
 *
 * ROWS ARE NOT RE-RANKED. The bundle supplies them strike-ascending as the chain reports them and
 * the card reverses to price-descending for display. Sorting by magnitude would produce a
 * perfectly readable chart of something that is not a gamma profile.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function GammaMapCard({
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
  const profile = bundle.gammaProfile!;
  const max = spec.stack ? 14 : 11;

  // Price-descending: high strikes at the top, the way every ladder on the desk reads.
  const rows = [...profile.rows].sort((a, b) => b.strike - a.strike).slice(0, max);
  const peak = Math.max(...rows.map((r) => Math.abs(r.gamma)), 1);

  const flip = profile.flipStrike ?? null;
  const spotVal = bundle.spot?.value ?? null;

  recorder.value("Gamma profile strikes", String(rows.length), profile.source);
  if (profile.expiryLabel) recorder.value("Expiry", profile.expiryLabel, profile.source);
  if (bundle.spot) recorder.value("Spot", bundle.spot.display, bundle.spot.source, bundle.spot.asOf);

  /**
   * Never restate the kicker. Without a headline this read "Dealer gamma profile" at 78px under a
   * kicker reading "DEALER GAMMA PROFILE" — the same words twice, occupying the slot that should
   * carry the card's conclusion. The flip level IS the conclusion of a gamma profile, so it takes
   * the slot when Largo supplied no verdict of its own.
   */
  const title =
    bundle.headline ??
    (profile.flipStrike != null
      ? `${bundle.ticker ? `${bundle.ticker} ` : ""}flip at ${profile.flipStrike.toLocaleString("en-US")}`
      : `${bundle.ticker ?? "Dealer"} gamma profile`);

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["THERMAL"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div
      key="t"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: s(22, spec),
      }}
    >
      <Kicker
        text={profile.expiryLabel ? `Dealer gamma · ${profile.expiryLabel}` : "Dealer gamma profile"}
        spec={spec}
        color={C.warn}
      />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={title} spec={spec} />
      </div>
    </div>,

    // Axis legend. Stated in words because a two-sided bar chart with no key is a Rorschach test.
    <div key="key" style={{ display: "flex", alignItems: "center", marginTop: s(16, spec) }}>
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontSize: s(14, spec),
          color: C.bear,
          letterSpacing: s(1, spec),
        }}
      >
        ◀ NEGATIVE (dealers short gamma)
      </div>
      <div
        style={{
          display: "flex",
          marginLeft: "auto",
          fontFamily: FONT.mono,
          fontSize: s(14, spec),
          color: C.bull,
          letterSpacing: s(1, spec),
        }}
      >
        POSITIVE (dealers long gamma) ▶
      </div>
    </div>,

    <div
      key="rows"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop: s(12, spec),
      }}
    >
      {rows.map((r, i) => {
        const positive = r.gamma >= 0;
        const color = positive ? C.bull : C.bear;
        const width = `${Math.max(2, (Math.abs(r.gamma) / peak) * 100)}%`;
        // A strike can be the flip AND the nearest to spot; both markers are drawn because they
        // are different facts and suppressing one would misreport the book.
        const isFlip = flip != null && r.strike === flip;
        const isSpotRow =
          spotVal != null && rows.every((o) => Math.abs(o.strike - spotVal) >= Math.abs(r.strike - spotVal));
        recorder.value(`${r.strike} γ`, r.display, profile.source);
        return (
          <div
            key={r.strike}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              marginTop: i === 0 ? 0 : s(5, spec),
              paddingTop: s(2, spec),
              paddingBottom: s(2, spec),
              background: isFlip ? "rgba(251,191,36,0.09)" : isSpotRow ? "rgba(34,211,238,0.07)" : "transparent",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontSize: s(17, spec),
                color: isFlip ? C.warn : isSpotRow ? C.info : C.muted,
                fontWeight: isFlip || isSpotRow ? 700 : 400,
                width: s(92, spec),
                flexShrink: 0,
              }}
            >
              {r.strike.toLocaleString("en-US")}
            </div>

            {/* Left half: negative gamma grows leftward from the centre axis. */}
            <div
              style={{
                display: "flex",
                flex: 1,
                justifyContent: "flex-end",
                height: s(15, spec),
              }}
            >
              {!positive && (
                <div
                  style={{
                    display: "flex",
                    width,
                    height: "100%",
                    background: color,
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                width: s(2, spec),
                flexShrink: 0,
                height: s(21, spec),
                background: C.rule,
              }}
            />
            {/* Right half: positive gamma grows rightward. */}
            <div style={{ display: "flex", flex: 1, height: s(15, spec) }}>
              {positive && (
                <div
                  style={{
                    display: "flex",
                    width,
                    height: "100%",
                    background: color,
                  }}
                />
              )}
            </div>

            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(16, spec),
                color,
                width: s(104, spec),
                flexShrink: 0,
                marginLeft: s(12, spec),
                justifyContent: "flex-end",
              }}
            >
              {r.display}
            </div>
          </div>
        );
      })}
    </div>,

    <div key="ax" style={{ display: "flex", marginTop: s(14, spec) }}>
      <Kicker
        text={
          flip != null
            ? `Axis = gamma flip ${flip.toLocaleString("en-US")}${bundle.spot ? ` · spot ${bundle.spot.display}` : ""}`
            : `Axis = zero gamma · no flip strike measured${bundle.spot ? ` · spot ${bundle.spot.display}` : ""}`
        }
        spec={spec}
      />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Thermal gamma exposure" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

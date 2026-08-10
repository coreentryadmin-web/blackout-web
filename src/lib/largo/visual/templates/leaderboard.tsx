/**
 * TRADE LEADERBOARD — "how did the desk do over this window?"
 *
 * THIS IS THE HIGHEST-RISK TEMPLATE IN THE LIBRARY and its design is mostly defences.
 *
 * 1. GRADED ROWS ONLY. TRADE_RECAP can honestly render an open position because it labels it
 *    "live mark-to-market · position open". A leaderboard cannot: ranking implies comparability
 *    implies these are results. So the sufficiency gate requires graded rows, and the bundle type
 *    carries no `graded` flag per row precisely so there is no way to sneak an ungraded one in.
 *
 * 2. THE DENOMINATOR IS RENDERED, ALWAYS, AND IT IS NOT OPTIONAL CHROME. `graded / wins / losses`
 *    sits at the top at full size. A card showing five winners out of forty trades is a true card
 *    and a dishonest one unless the forty is on it. This is the same failure that shipped #1911
 *    (a two-losing-trades screenshot under alt text promising wins) from the other direction.
 *
 * 3. LOSERS ARE DRAWN. Rows are whatever the bundle supplies, in its order, and a negative return
 *    renders in bear red at the same size as a winner. There is no filter here and no "top N by
 *    return" — the caller that assembles the bundle is responsible for the window, and the card
 *    refuses to be the place where a selection quietly happens.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker } from "../primitives";

export function LeaderboardCard({
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
  const lb = bundle.leaderboard!;
  const rows = lb.rows.slice(0, spec.stack ? 7 : 5);
  const peak = Math.max(...rows.map((r) => Math.abs(r.returnValue)), 1);

  recorder.value("Graded trades", String(lb.graded), lb.source);
  recorder.value("Wins", String(lb.wins), lb.source);
  recorder.value("Losses", String(lb.losses), lb.source);
  if (lb.winRateDisplay) recorder.value("Win rate", lb.winRateDisplay, lb.source);
  else recorder.omit("win rate");

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={["NIGHT HAWK"]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div
      key="t"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: s(22, spec),
      }}
    >
      <Kicker text={`Graded results · ${lb.windowLabel}`} spec={spec} color={C.info} />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={bundle.headline ?? "Booked results"} spec={spec} />
      </div>
    </div>,

    // The denominator strip. Deliberately the second-largest thing on the card.
    <div key="tally" style={{ display: "flex", width: "100%", marginTop: s(18, spec) }}>
      {[
        { label: "Graded", value: String(lb.graded), color: C.primary },
        { label: "Wins", value: String(lb.wins), color: C.bull },
        { label: "Losses", value: String(lb.losses), color: C.bear },
        ...(lb.winRateDisplay ? [{ label: "Win rate", value: lb.winRateDisplay, color: C.info }] : []),
      ].map((t, i) => (
        <div
          key={t.label}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : s(12, spec),
            padding: s(12, spec),
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <Kicker text={t.label} spec={spec} />
          <div
            style={{
              display: "flex",
              fontFamily: FONT.display,
              fontSize: s(42, spec),
              color: t.color,
              marginTop: s(4, spec),
            }}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>,

    <div
      key="rows"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop: s(20, spec),
      }}
    >
      {rows.map((r, i) => {
        const positive = r.returnValue >= 0;
        const color = positive ? C.bull : C.bear;
        recorder.value(`${r.ticker} booked`, r.returnDisplay, lb.source);
        return (
          <div
            key={`${r.ticker}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: `${s(10, spec)}px ${s(12, spec)}px`,
              marginTop: i === 0 ? 0 : s(6, spec),
              background: "rgba(255,255,255,0.015)",
              borderLeft: `${s(3, spec)}px solid ${color}`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: s(190, spec),
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(21, spec),
                  color: C.primary,
                }}
              >
                {r.ticker}
              </div>
              {(r.contract || r.dateLabel) && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(14, spec),
                    color: C.faint,
                    marginTop: s(3, spec),
                  }}
                >
                  {[r.dateLabel, r.contract].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            {/* Bar scaled on |return| so a −50% stop reads as visually as heavy as a +50% win.
                Scaling on the signed value would make losses look smaller than they are. */}
            <div
              style={{
                display: "flex",
                flex: 1,
                height: s(13, spec),
                background: "rgba(255,255,255,0.03)",
                marginRight: s(14, spec),
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: `${Math.max(3, (Math.abs(r.returnValue) / peak) * 100)}%`,
                  height: "100%",
                  background: color,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: s(24, spec),
                color,
                width: s(118, spec),
                flexShrink: 0,
                justifyContent: "flex-end",
              }}
            >
              {r.returnDisplay}
            </div>
          </div>
        );
      })}
    </div>,

    <div key="note" style={{ display: "flex", marginTop: s(14, spec) }}>
      <Kicker
        text={
          rows.length < lb.graded
            ? `Showing ${rows.length} of ${lb.graded} graded trades · tally covers all ${lb.graded}`
            : `All ${lb.graded} graded trades in the window`
        }
        spec={spec}
      />
    </div>,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Night Hawk ledger · graded rows only" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}

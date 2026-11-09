import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DiscoveryRationale } from "./BangerBoard.tsx";

(globalThis as unknown as { React: typeof React }).React = React;

// BUG FIX (round 483): `DiscoveryRationale`'s "$-volume" stat used to hand-roll
// `$${(v / 1_000_000).toFixed(1)}M` — no billions tier, and no round-first-then-promote guard at
// the M boundary. `screenBangerMovers` (src/lib/banger/discovery.ts) ranks candidates by raw
// dollar-volume DESCENDING with a $5-$400 price band and no upper volume cap, so this card's
// highest-ranked candidates are exactly the ones most likely to carry a multi-billion-dollar
// `dollar_vol` (a $300 stock trading 10M+ shares on a breakout day clears $3B easily).
describe("BangerBoard DiscoveryRationale: $-volume formatting", () => {
  it("promotes a billions-scale dollar_vol to the B tier instead of an overflowed 4-digit M label", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiscoveryRationale, {
        discovery: { gain: 0.08, vol: 10_000_000, dollar_vol: 2_500_000_000, close_strength: 0.9 },
      })
    );
    assert.match(html, /\$2\.5B/, "2.5 billion dollars of volume must read \"$2.5B\"");
    assert.doesNotMatch(html, /\$2500\.0M/, "must never render the un-promoted, wrong-unit \"$2500.0M\"");
  });

  it("promotes a dollar_vol that ROUNDS to 1000.0M across the boundary, not just one that exceeds $1B outright", () => {
    // 999_950_000 / 1e6 = 999.95, which .toFixed(1) rounds to "1000.0" — the exact
    // round-first-then-promote boundary bug already fixed ~18+ times elsewhere in this repo
    // (fmt-money.ts's own fmtPremium, zerodte-board-format.ts, helix-flow-format.ts, spx-pulse.ts).
    const html = renderToStaticMarkup(
      React.createElement(DiscoveryRationale, {
        discovery: { gain: 0.06, vol: 4_000_000, dollar_vol: 999_950_000, close_strength: 0.85 },
      })
    );
    assert.match(html, /\$1\.0B/, "a dollar_vol that rounds to 1000.0M must promote to \"$1.0B\"");
    assert.doesNotMatch(html, /\$1000\.0M/, "must never render the literal overflowed \"$1000.0M\"");
  });

  it("still renders an ordinary sub-billion dollar_vol as an M figure", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiscoveryRationale, {
        discovery: { gain: 0.05, vol: 1_000_000, dollar_vol: 38_200_000, close_strength: 0.7 },
      })
    );
    assert.match(html, /\$38\.2M/);
  });
});

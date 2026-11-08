import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoCompareCard } from "./LargoCompareCard";
import type {
  LargoCompareCard as LargoCompareCardPayload,
  HelixThermalSide,
} from "@/lib/largo/compare-card-types";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * REGRESSION (round 422): same `formatPrem(n)` duplicate+bug as LargoPreEarningsPackCard.tsx —
 * this file had its OWN separate copy of the identical buggy formatter (the exact
 * "duplicated logic drifted" blast radius the PR write-up policy requires naming), hit on both
 * render paths that display `net_premium`: the HELIX-vs-Thermal compare side and the peer-ticker
 * table row. A net_premium of ~$999,700 rounded the K branch to a four-digit "1000K" instead of
 * promoting to "1.0M". Fixed the same way as the sibling card: deleted both local copies, reused
 * the already-tested shared `fmtPremium` from `@/lib/fmt-money`.
 */

function flowSide(net_premium: number | null): HelixThermalSide {
  return {
    available: true,
    bias: "bullish",
    summary: "Calls dominate the tape",
    net_premium,
  };
}

function gammaSide(): HelixThermalSide {
  return {
    available: true,
    bias: "neutral",
    summary: "Long gamma, dealers suppressing",
    flip: 100,
  };
}

function helixThermalCard(net_premium: number | null): LargoCompareCardPayload {
  return {
    kind: "helix_thermal",
    ticker: "ACME",
    as_of: "2026-11-08 09:31 ET",
    helix: flowSide(net_premium),
    thermal: gammaSide(),
    conflict: false,
    conflict_note: null,
  };
}

function peerCard(net_premium: number | null): LargoCompareCardPayload {
  return {
    kind: "peer_tickers",
    tickers: ["ACME", "BETA"],
    as_of: "2026-11-08 09:31 ET",
    rows: [
      {
        ticker: "ACME",
        flow: flowSide(net_premium),
        gamma: gammaSide(),
        conflict: false,
        conflict_note: null,
      },
    ],
    peer_divergence: false,
    peer_divergence_note: null,
  };
}

const render = (card: LargoCompareCardPayload) =>
  renderToStaticMarkup(React.createElement(LargoCompareCard, { card }));

test("REGRESSION: HELIX-vs-Thermal side net_premium just under $1M renders '$1.0M', never '$1000K'", () => {
  const html = render(helixThermalCard(999_700));

  assert.match(html, /\$1\.0M/, "a value that rounds to 1000K must promote to the next unit");
  assert.doesNotMatch(html, /1000K/, "the overflowed four-digit K label must never render");
});

test("REGRESSION: peer-ticker row net_premium just under $1M renders '$1.0M', never '$1000K'", () => {
  const html = render(peerCard(999_700));

  assert.match(html, /\$1\.0M/, "a value that rounds to 1000K must promote to the next unit");
  assert.doesNotMatch(html, /1000K/, "the overflowed four-digit K label must never render");
});

test("net_premium comfortably inside the K/M tiers renders normally on both views", () => {
  const htmlHelix = render(helixThermalCard(456_700));
  assert.match(htmlHelix, /\$457K/);

  const htmlPeer = render(peerCard(38_200_000));
  assert.match(htmlPeer, /\$38\.2M/);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryFunnelStrip, MarketStateStrip } from "./zerodte-board-strips";

(globalThis as unknown as { React: typeof React }).React = React;

test("MarketStateStrip renders regime + rail weights", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarketStateStrip, {
      ms: {
        session_date: "2026-08-03",
        regime_structure: "TREND_UP",
        regime_vol: "NORMAL_IV",
        regime_label: "trend up · normal-iv",
        confidence: 0.85,
        rail_weights: { FLOW: 1.21, BREAKOUT: 1.17, PIN: 0.7 },
        summary: "trend up session — FLOW×1.21 BREAKOUT×1.17 PIN×0.7",
        calibration_shadow: null,
      },
    }),
  );
  assert.match(html, /data-testid="zerodte-market-state-strip"/);
  assert.match(html, /trend up/);
  assert.match(html, /×1\.21/);
});

test("DiscoveryFunnelStrip renders summary one-liner", () => {
  const html = renderToStaticMarkup(
    React.createElement(DiscoveryFunnelStrip, {
      funnel: {
        detected_tickers: 0,
        gate_blocked_events: 0,
        commit_events: 0,
        top_gate: "score_floor",
        top_gate_label: "Score floor (G-3)",
        top_gate_n: 30,
        summary: "Top gate today: Score floor (G-3) (30)",
      },
    }),
  );
  assert.match(html, /data-testid="zerodte-discovery-funnel-strip"/);
  assert.match(html, /Funnel · Top gate today/);
});

test("DiscoveryFunnelStrip hides when summary empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(DiscoveryFunnelStrip, {
      funnel: {
        detected_tickers: 0,
        gate_blocked_events: 0,
        commit_events: 0,
        top_gate: null,
        top_gate_label: null,
        top_gate_n: 0,
        summary: null,
      },
    }),
  );
  assert.equal(html, "");
});

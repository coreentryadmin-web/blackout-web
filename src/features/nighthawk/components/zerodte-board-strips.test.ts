import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryFunnelStrip, MarketStateStrip, SpxSlayerBadgeStrip } from "./zerodte-board-strips";

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

test("SpxSlayerBadgeStrip renders nothing when badge is undefined (payload predates the field)", () => {
  const html = renderToStaticMarkup(React.createElement(SpxSlayerBadgeStrip, { badge: undefined }));
  assert.equal(html, "");
});

test("SpxSlayerBadgeStrip renders an idle/unavailable state without crashing when badge is null", () => {
  const html = renderToStaticMarkup(React.createElement(SpxSlayerBadgeStrip, { badge: null }));
  assert.match(html, /data-testid="spx-slayer-badge"/);
  assert.match(html, /is-idle/);
  assert.match(html, /IDLE/);
});

test("SpxSlayerBadgeStrip renders a live BUY/long play with grade + direction", () => {
  const html = renderToStaticMarkup(
    React.createElement(SpxSlayerBadgeStrip, {
      badge: {
        available: true,
        symbol: "SPX",
        phase: "SCANNING",
        action: "BUY",
        direction: "long",
        grade: "A",
        score: 82,
        headline: "Buy 6300C @ 4.20-4.60",
        as_of: "2026-08-05T14:30:00.000Z",
        unavailable_reason: null,
      },
    }),
  );
  assert.match(html, /data-testid="spx-slayer-badge"/);
  assert.doesNotMatch(html, /is-idle/);
  assert.match(html, /SPX Slayer/);
  assert.match(html, />BUY</);
  assert.match(html, />A</);
});

test("SpxSlayerBadgeStrip surfaces the unavailable_reason in its title when degraded", () => {
  const html = renderToStaticMarkup(
    React.createElement(SpxSlayerBadgeStrip, {
      badge: {
        available: false,
        symbol: "SPX",
        phase: "SCANNING",
        action: "SCANNING",
        direction: null,
        grade: "D",
        score: 0,
        headline: "SPX Slayer unavailable",
        as_of: "2026-08-05T14:30:00.000Z",
        unavailable_reason: "SPX Slayer desk unavailable — retrying",
      },
    }),
  );
  assert.match(html, /SPX Slayer desk unavailable — retrying/);
});

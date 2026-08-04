import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./TerminalPremiumPanels");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "182C · 0DTE",
    occ: "NVDA260725C00182000",
    score: 80,
    status: "CLOSED",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 2,
    mark: 1,
    pnlPct: -50,
    peak: 14,
    trough: -50,
    exitPnlPct: -50,
    ...overrides,
  };
}

test("TradeExcursionGraphic renders entry-centered MAE/MFE bar (stats row only, no journey chart)", async () => {
  const { TradeExcursionGraphic } = await load();
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, { play: play() }),
  );
  assert.match(html, /nh-deck-excursion-graphic/);
  assert.match(html, /Worst/);
  assert.match(html, /Entry/);
  assert.match(html, /Best/);
  assert.match(html, /Close/);
  assert.match(html, /-50%/);
  assert.match(html, /\+14%/);
  // Night Hawk panel declutter (docs/audit/FINDINGS.md, 2026-08-04): the SVG "journey" line
  // chart re-plotted the same Entry/Peak/Current values a 3rd/4th time alongside the hero and
  // this stats row — removed. The stats row above is kept (the "1-2 renderings max" middle
  // ground), the redundant SVG spine must never come back.
  assert.doesNotMatch(html, /nh-deck-excursion-graphic__journey/);
});

test("ThesisChecklistPanel: merges pillar checks under one taxonomy, no duplicate Flow/Breadth/Gamma rows", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({
        thesisHealth: {
          health: 82,
          currentIndex: 92,
          advisory: "Thesis intact",
          pillars: [
            { id: "flow", label: "Flow", status: "intact" },
            { id: "dealer", label: "Dealer", status: "intact" },
            { id: "vwap", label: "VWAP", status: "intact" },
            { id: "market", label: "Breadth", status: "intact" },
            { id: "structure", label: "Gamma", status: "faded" },
            { id: "volatility", label: "Vol", status: "lost" },
          ],
          committedAtEt: "10:15",
        },
      }),
    }),
  );
  assert.match(html, /Engine Checklist/);
  for (const label of ["Dealer", "Flow", "VWAP", "Breadth", "Gamma", "Vol", "Momentum"]) {
    const count = (html.match(new RegExp(`>${label}<`, "g")) ?? []).length;
    assert.equal(count, 1, `expected exactly one "${label}" row, got ${count}`);
  }
});

test("ThesisChecklistPanel: renders tier-factor breakdown for Legacy plays (no pillar data)", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({
        horizon: "LEGACY",
        thesisHealth: null,
        tierLabel: "A",
        tierFactors: [
          { label: "Prime score band", direction: "up", detail: "Score in the top decile." },
          { label: "Strong signal breadth", direction: "up", detail: "3+ confirming signals." },
        ],
      }),
    }),
  );
  assert.match(html, /Merit tier/);
  assert.match(html, /Prime score band/);
  assert.match(html, /Strong signal breadth/);
});

test("ThesisChecklistPanel: renders nothing when neither pillar nor tier data is present", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({ thesisHealth: null, tierFactors: null }),
    }),
  );
  assert.equal(html, "");
});

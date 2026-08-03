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

test("TradeExcursionGraphic renders entry-centered MAE/MFE bar and journey", async () => {
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
  assert.match(html, /nh-deck-excursion-graphic__journey-path/);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./PlayTimelinePanel");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "182C · 0DTE",
    score: 80,
    status: "CLOSED",
    horizon: "ZERO_DTE",
    exitModel: "SCALE_OUT",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    firstFlaggedAt: "2026-08-03T11:20:00-04:00",
    timelineTranches: [
      { tranche: 1, fraction: 0.333, exit_pnl_pct: 35, exit_reason: "trim_scale_first", at_et: "12:01" },
      { tranche: 2, fraction: 0.333, exit_pnl_pct: 87, exit_reason: "trim_scale_second", at_et: "12:45" },
      { tranche: 3, fraction: 0.334, exit_pnl_pct: -50, exit_reason: "stopped", at_et: "14:12" },
    ],
    ...overrides,
  };
}

test("PlayTimelinePanel renders timed vertical replay nodes", async () => {
  const { PlayTimelinePanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(PlayTimelinePanel, {
      play: play(),
      nowMs: Date.parse("2026-08-03T14:30:00-04:00"),
    }),
  );
  assert.match(html, /nh-deck-timeline/);
  assert.match(html, />Triggered</);
  assert.match(html, />11:20</);
  assert.match(html, />12:45</);
  assert.match(html, />Stopped</);
  assert.match(html, /reconstructed/i);
});

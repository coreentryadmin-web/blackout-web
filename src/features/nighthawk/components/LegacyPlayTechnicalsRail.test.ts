import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { terminalPlayToLegacyRow } from "@/features/nighthawk/lib/legacy-board-table-utils";

// Same idiom as PlaybookBriefingPanel.test.ts: a .test.ts (createElement, no JSX) so CI's
// `src/**/*.test.ts` glob actually picks it up, with the classic-JSX-runtime global React
// polyfill set BEFORE the dynamic import.
(globalThis as unknown as { React: typeof React }).React = React;

const loadRail = () => import("./LegacyPlayTechnicalsRail");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "LEGACY-AAPL",
    ticker: "AAPL",
    contract: "AAPL 327.5C 9/18",
    direction: "LONG",
    status: "OPEN",
    recommendation: "BUY",
    rank: 1,
    factors: [],
    gates: [],
    thesisBreak: null,
    ...overrides,
  } as TerminalPlay;
}

async function render(row: ReturnType<typeof terminalPlayToLegacyRow>, currentRegime: string | null) {
  const { LegacyPlayTechnicalsRail } = await loadRail();
  return renderToStaticMarkup(
    React.createElement(LegacyPlayTechnicalsRail, { row, currentRegime })
  );
}

// ── Regime alignment: play.regime (captured at ~7pm ET publish) and the board's own live
// macro.regime both already existed, but nothing ever compared them — a member had to mentally
// diff two separately-rendered strings to notice an overnight regime flip. ────────────────────

test("renders an intact-regime bullet when the pick's regime still matches today's live regime", async () => {
  const row = terminalPlayToLegacyRow(play({ regime: "RISK_ON" }), "2026-09-11");
  const html = await render(row, "RISK_ON");
  assert.match(html, /Still RISK_ON/);
});

test("renders a drift warning when the market regime has flipped since publish", async () => {
  const row = terminalPlayToLegacyRow(play({ regime: "RISK_ON" }), "2026-09-11");
  const html = await render(row, "RISK_OFF");
  assert.match(html, /Published in RISK_ON/);
  assert.match(html, /market now RISK_OFF/);
});

test("renders no regime bullet when either side is unknown", async () => {
  const row = terminalPlayToLegacyRow(play({ regime: null }), "2026-09-11");
  const html = await render(row, "RISK_ON");
  assert.doesNotMatch(html, /Still RISK_ON|Published in/);
});

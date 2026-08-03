import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./CommandDeck");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:META",
    ticker: "META",
    direction: "LONG",
    contract: "592.5C · 0DTE",
    occ: "META260725C00592500",
    score: 96,
    status: "CLOSED",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [{ label: "Flow", points: 12 }],
    gates: [{ label: "Hard gate", ok: true }],
    recommendation: "HOLD",
    entry: 3.15,
    mark: 1.57,
    pnlPct: -50,
    peak: 87,
    trough: -50,
    tierLabel: "A+",
    discoveryOrigin: ["BREAKOUT"],
    firstFlaggedAt: "2026-08-03T09:42:00-04:00",
    ...overrides,
  };
}

async function render(
  p: TerminalPlay,
  opts: { rank?: number; selected?: boolean } = {},
): Promise<string> {
  const { PlayCard } = await load();
  return renderToStaticMarkup(
    React.createElement(PlayCard, {
      play: p,
      rank: opts.rank ?? 1,
      selected: opts.selected ?? false,
      onSelect: () => {},
      nowMs: Date.now(),
    }),
  );
}

test("closed row shows Peak Return as the primary number", async () => {
  const html = await render(play({ status: "CLOSED", peak: 87, pnlPct: -50 }));
  assert.match(html, />\+87%|▲ \+87%/);
  assert.match(html, />Peak Return</);
});

test("closed row never shows dead MID label when peak is present", async () => {
  const html = await render(play({ status: "CLOSED", peak: 87, mark: 1.57 }));
  assert.doesNotMatch(html, />MID</);
});

test("open row still shows MID not Peak Return", async () => {
  const html = await render(play({ status: "OPEN", peak: 87 }));
  assert.doesNotMatch(html, />Peak Return</);
  assert.match(html, />MID</);
});

test("0DTE compact row leads with rank, grade, and stars", async () => {
  const html = await render(play({ tierLabel: "A+", score: 96 }), { selected: false, rank: 1 });
  assert.match(html, /nh-deck-rank-lead/);
  assert.match(html, />#1</);
  assert.match(html, />A\+</);
  assert.match(html, /★{5}/);
  assert.match(html, />96%/);
});

test("0DTE compact row demotes ticker below rank lead", async () => {
  const html = await render(play({ tierLabel: "A+" }), { selected: false, rank: 1 });
  const rankIdx = html.indexOf("#1");
  const metaIdx = html.indexOf(">META<");
  assert.ok(rankIdx >= 0 && metaIdx > rankIdx, "rank should appear before ticker in markup");
  assert.doesNotMatch(html, /nh-deck-row-head/);
});

test("selected 0DTE row renders hero card with banner when rank 1", async () => {
  const html = await render(play(), { selected: true, rank: 1 });
  assert.match(html, /nh-deck-row-hero/);
  assert.match(html, />BEST PLAY TODAY</);
  assert.match(html, />#1</);
  assert.match(html, />Confidence/);
  assert.match(html, />Tap to inspect/);
});

test("selected rank-2 row is hero without BEST PLAY banner", async () => {
  const html = await render(play({ id: "0DTE:AMD", ticker: "AMD", peak: 14 }), {
    selected: true,
    rank: 2,
  });
  assert.match(html, /nh-deck-row-hero/);
  assert.doesNotMatch(html, />BEST PLAY TODAY</);
});

test("legacy row omits 0DTE grade chips", async () => {
  const html = await render(
    play({ horizon: "LEGACY", tierLabel: "A", stockPrice: 180, pnlPct: 5 }),
    { selected: false },
  );
  assert.doesNotMatch(html, /nh-deck-grade-inline/);
});

test("row shows ET flag time when firstFlaggedAt is present", async () => {
  const html = await render(play());
  assert.match(html, />09:42 ET</);
});

test("discovery origin chip on enhanced 0DTE row", async () => {
  const html = await render(play({ discoveryOrigin: ["BREAKOUT"] }), { selected: false });
  assert.match(html, />BREAKOUT</);
});

test("CommandDeck command center renders stat strip for 0DTE", async () => {
  const { CommandDeck } = await load();
  const html = renderToStaticMarkup(
    React.createElement(CommandDeck, {
      plays: [
        play({ id: "0DTE:META", ticker: "META", tierLabel: "A+" }),
        play({ id: "0DTE:AMD", ticker: "AMD", tierLabel: "B" }),
      ],
      laneLabel: "0DTE · same-day",
      commandCenter: true,
      winRate30d: 81,
    }),
  );
  assert.match(html, /nh-deck-cmd/);
  assert.match(html, /Opportunities/);
  assert.match(html, />Top Rated</);
  assert.match(html, />META \(A\+\)/);
  assert.match(html, />Win Rate \(30d\)</);
  assert.match(html, />81%/);
  assert.match(html, /Today.*Edge/);
  assert.match(html, />High</);
});

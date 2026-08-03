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
    exitAt: "2026-08-03T12:06:00-04:00",
    exitPnlPct: 42,
    ...overrides,
  };
}

async function render(
  p: TerminalPlay,
  opts: { rank?: number; selected?: boolean; nowMs?: number } = {},
): Promise<string> {
  const { PlayCard } = await load();
  return renderToStaticMarkup(
    React.createElement(PlayCard, {
      play: p,
      rank: opts.rank ?? 1,
      selected: opts.selected ?? false,
      onSelect: () => {},
      nowMs: opts.nowMs ?? Date.parse("2026-08-03T12:00:00-04:00"),
    }),
  );
}

test("closed lifecycle row shows peak and realized returns", async () => {
  const html = await render(play());
  assert.match(html, />Peak</);
  assert.match(html, />\+87%</);
  assert.match(html, />Realized</);
  assert.match(html, />\+42%</);
  assert.match(html, />CLOSED</);
});

test("open lifecycle row shows freshness, current, and active status", async () => {
  const html = await render(
    play({
      status: "OPEN",
      pnlPct: 42,
      peak: 87,
      firstFlaggedAt: "2026-08-03T11:58:00-04:00",
    }),
    { nowMs: Date.parse("2026-08-03T12:00:00-04:00") },
  );
  assert.match(html, /JUST FIRED|MIN AGO/);
  assert.match(html, />Triggered</);
  assert.match(html, />Current</);
  assert.match(html, />\+42%</);
  assert.match(html, />ACTIVE</);
});

test("watch lifecycle row shows published clock and watching status", async () => {
  const html = await render(
    play({
      status: "WATCH",
      detectedAt: "2026-08-03T11:54:00-04:00",
      firstFlaggedAt: null,
      pnlPct: null,
      peak: null,
    }),
    { nowMs: Date.parse("2026-08-03T12:00:00-04:00") },
  );
  assert.match(html, />WATCH</);
  assert.match(html, />Waiting for Trigger</);
  assert.match(html, />Published</);
  assert.match(html, />WATCHING</);
});

test("selected 0DTE row renders hero lifecycle card with banner when rank 1", async () => {
  const html = await render(play({ status: "OPEN", pnlPct: 42 }), { selected: true, rank: 1 });
  assert.match(html, /nh-deck-row-hero/);
  assert.match(html, />BEST PLAY TODAY</);
  assert.match(html, />Confidence/);
  assert.match(html, />Tap to inspect/);
});

test("legacy row omits lifecycle layout", async () => {
  const html = await render(
    play({ horizon: "LEGACY", tierLabel: "A", stockPrice: 180, pnlPct: 5 }),
    { selected: false },
  );
  assert.doesNotMatch(html, /nh-deck-lc/);
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
  assert.match(html, />META \(A\+\)/);
});

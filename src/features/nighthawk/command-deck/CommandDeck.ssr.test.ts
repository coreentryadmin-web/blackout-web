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
  assert.match(html, /nh-deck-age-decay/);
  assert.match(html, />2m</);
  assert.match(html, />Current</);
  assert.match(html, />\+42%</);
  assert.match(html, />ACTIVE</);
  assert.match(html, /nh-deck-status-pill is-active/);
  assert.match(html, /nh-deck-lc-ticker/);
  assert.match(html, /★★★★★/);
  assert.doesNotMatch(html, />Triggered</);
});

test("watch lifecycle row shows hierarchy, confidence, and compact age", async () => {
  const html = await render(
    play({
      status: "WATCH",
      detectedAt: "2026-08-03T11:54:00-04:00",
      firstFlaggedAt: null,
      pnlPct: null,
      trackPct: 18,
      trackReferencePremium: 4.2,
      peak: null,
    }),
    { nowMs: Date.parse("2026-08-03T12:00:00-04:00"), rank: 2 },
  );
  assert.match(html, /nh-deck-lc-ticker/);
  assert.match(html, />META</);
  assert.match(html, /★★★★★/);
  assert.match(html, /nh-deck-lc-rank-corner/);
  assert.match(html, />#2</);
  assert.match(html, />WATCH</);
  assert.match(html, />Waiting for Trigger</);
  assert.match(html, />Since flag</);
  assert.match(html, />\+18%/);
  assert.match(html, />Confidence</);
  assert.match(html, />96</);
  assert.match(html, />6m</);
  assert.doesNotMatch(html, />Published</);
  assert.match(html, /nh-deck-status-pill/);
  assert.match(html, /nh-deck-conf-badge-list/);
});

test("selected 0DTE row renders hero lifecycle card with banner when rank 1", async () => {
  const html = await render(play({ status: "OPEN", pnlPct: 42 }), { selected: true, rank: 1 });
  assert.match(html, /nh-deck-row-hero/);
  assert.match(html, />BEST PLAY TODAY</);
  assert.match(html, /nh-deck-conf-badge/);
  assert.match(html, />Tap to inspect/);
});

test("legacy row uses lifecycle layout", async () => {
  const html = await render(
    play({ horizon: "LEGACY", tierLabel: "A", stockPrice: 180, pnlPct: 5, detectedAt: "2026-08-03T17:30:00-04:00" }),
    { selected: false },
  );
  assert.match(html, /nh-deck-lc/);
  assert.match(html, />LEGACY</);
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
      boardAsOf: "2026-08-03T11:59:58-04:00",
      sessionHeat: "RTH",
    }),
  );
  assert.match(html, /nh-deck-cmd/);
  assert.match(html, />META \(A\+\)/);
  assert.doesNotMatch(html, /Win Rate \(30d\)/);
  assert.match(html, /nh-deck-engine-status/);
  assert.match(html, />Engine</);
  assert.match(html, />Monitoring</);
  assert.match(html, />Last Update</);
});

test("CommandDeck renders market state + funnel strips for 0DTE", async () => {
  const { CommandDeck } = await load();
  const html = renderToStaticMarkup(
    React.createElement(CommandDeck, {
      plays: [play()],
      laneLabel: "0DTE · same-day",
      commandCenter: true,
      deckHorizon: "ZERO_DTE",
      marketState: {
        session_date: "2026-08-03",
        regime_structure: "TREND_UP",
        regime_vol: "NORMAL_IV",
        regime_label: "trend up · normal-iv",
        confidence: 0.85,
        rail_weights: { FLOW: 1.21, BREAKOUT: 1.17, PIN: 0.7 },
        summary: "trend up session — FLOW×1.21 BREAKOUT×1.17 PIN×0.7",
        calibration_shadow: null,
      },
      discoveryFunnel: {
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
  assert.match(html, /data-testid="zerodte-market-state-strip"/);
  assert.match(html, /data-testid="zerodte-discovery-funnel-strip"/);
  assert.match(html, /Funnel · Top gate today/);
});

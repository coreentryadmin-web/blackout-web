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

test("closed compact row shows symbol line, times, peak", async () => {
  const html = await render(play());
  assert.match(html, /nh-deck-play-grid/);
  assert.match(html, />META 592\.5C 0DTE</);
  assert.match(html, />09:42→12:06</);
  assert.match(html, />\+87%/);
  assert.match(html, />CLOSED</);
  assert.match(html, /nh-deck-play-grade/);
  assert.match(html, />A\+</);
  assert.match(html, /★{5}/);
  assert.match(html, />96</);
});

// UPDATED 2026-08-07: this asserted the PEAK (+87%) on a row whose CURRENT read is +42% — the
// fixture had both, and the assertion picked the wrong one. That is the live regression this test
// silently ratified: KRE rendered +73% while the position was -34.1%. An open row must render where
// it stands, not its high-water mark. (The closed-row test above still asserts peak deliberately —
// closed-row semantics were left unchanged; see playListReturnPct.)
test("open compact row shows active status and the CURRENT return, not the peak", async () => {
  const html = await render(
    play({
      status: "OPEN",
      pnlPct: 42,
      peak: 87,
      firstFlaggedAt: "2026-08-03T11:58:00-04:00",
    }),
    { nowMs: Date.parse("2026-08-03T12:00:00-04:00") },
  );
  assert.match(html, />META 592\.5C 0DTE</);
  assert.match(html, />11:58</);
  assert.match(html, />\+42%/);
  assert.doesNotMatch(html, />\+87%/, "the peak must not be rendered as the row's PNL");
  assert.match(html, />ACTIVE</);
  assert.match(html, /nh-deck-status-pill is-active/);
});

test("watch compact row shows track and rank", async () => {
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
  assert.match(html, />META 592\.5C 0DTE</);
  assert.match(html, />#2</);
  assert.match(html, />WATCH</);
  assert.match(html, />\+18%/);
  assert.match(html, />11:54</);
});

test("selected row stays compact — detail on right rail only", async () => {
  const html = await render(play({ status: "OPEN", pnlPct: 42 }), { selected: true, rank: 1 });
  assert.match(html, /nh-deck-row-lifecycle-compact/);
  assert.doesNotMatch(html, /nh-deck-row-hero/);
  assert.doesNotMatch(html, />BEST PLAY TODAY</);
});

test("legacy row uses compact strip", async () => {
  const html = await render(
    play({ horizon: "LEGACY", tierLabel: "A", stockPrice: 180, pnlPct: 5, detectedAt: "2026-08-03T17:30:00-04:00" }),
    { selected: false },
  );
  assert.match(html, /nh-deck-play-grid/);
  assert.match(html, />META 592\.5C 0DTE</);
});

test("command center renders sortable play table column headers", async () => {
  const { CommandDeck } = await load();
  const html = renderToStaticMarkup(
    React.createElement(CommandDeck, {
      plays: [play()],
      laneLabel: "0DTE · same-day",
      commandCenter: true,
    }),
  );
  assert.match(html, /nh-deck-play-table-head/);
  assert.match(html, /nh-deck-play-th--sort/);
  assert.match(html, />Status</);
  assert.match(html, />Play</);
  assert.match(html, />Rating</);
  assert.match(html, />Time</);
  assert.match(html, />PnL</);
  assert.match(html, /aria-sort="descending"/);
  assert.doesNotMatch(html, /nh-deck-sortbar/);
  assert.doesNotMatch(html, />TRIGGERED</);
});

// Was "CommandDeck command center renders stat strip for 0DTE" — the Opps/Top/Edge stat strip +
// engine heartbeat it asserted on were REMOVED from DeckCompactHeader per explicit product
// direction (2026-08-28 page declutter): redundant with the view toggle above and the play list
// itself, and they pushed the actual trade queue below the fold. This now pins the opposite: the
// compact header renders ONLY the filter row, none of the removed chrome.
test("CommandDeck command center header is filters-only — no stat strip, no engine heartbeat", async () => {
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
  assert.match(html, /nh-deck-header-compact/);
  assert.match(html, /nh-deck-hdr-row--filters/);
  assert.doesNotMatch(html, /nh-deck-cmd\b/);
  assert.doesNotMatch(html, /nh-deck-cmd-lane/);
  assert.doesNotMatch(html, />META \(A\+\)/);
  assert.doesNotMatch(html, /nh-deck-engine-status/);
  assert.doesNotMatch(html, />Engine</);
  assert.doesNotMatch(html, />Updated</);
});

test("CommandDeck command center hides regime/funnel strips; prominent status filters", async () => {
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
  assert.doesNotMatch(html, /data-testid="zerodte-market-state-strip"/);
  assert.doesNotMatch(html, /data-testid="zerodte-discovery-funnel-strip"/);
  assert.doesNotMatch(html, /Top gate today/);
  assert.match(html, /nh-deck-filterbar--prominent/);
  assert.match(html, />ALL /);
  assert.match(html, />OPEN /);
  assert.match(html, />WATCH /);
  assert.match(html, />CLOSED /);
});

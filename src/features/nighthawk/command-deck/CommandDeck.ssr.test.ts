import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

// Classic JSX runtime in this test context expects a global React (same idiom as
// PlayTerminal.ssr.test.ts).
(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./CommandDeck");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:META",
    ticker: "META",
    direction: "LONG",
    contract: "592.5C · 0DTE",
    occ: "META260725C00592500",
    score: 80,
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
    firstFlaggedAt: "2026-08-03T09:42:00-04:00",
    ...overrides,
  };
}

async function render(p: TerminalPlay): Promise<string> {
  const { PlayCard } = await load();
  return renderToStaticMarkup(
    React.createElement(PlayCard, { play: p, rank: 1, selected: false, onSelect: () => {}, nowMs: Date.now() })
  );
}

// ── Peak-excursion badge (the "looks like a pure loser" fix) ──────────────────────────
test("closed row with a peak that ran green before stopping out shows the peak% badge", async () => {
  const html = await render(play({ status: "CLOSED", peak: 87, pnlPct: -50 }));
  assert.match(html, /nh-deck-cbadge pk/);
  assert.match(html, />pk \+87%</);
});

test("open row (not yet closed) does not show the peak badge, even if peak is present", async () => {
  const html = await render(play({ status: "OPEN", peak: 87 }));
  assert.doesNotMatch(html, /nh-deck-cbadge pk/);
});

test("closed row with no peak data (older/degraded row) omits the badge, never fabricates one", async () => {
  const html = await render(play({ status: "CLOSED", peak: null }));
  assert.doesNotMatch(html, /nh-deck-cbadge pk/);
});

test("negative peak renders without a stray '+' sign", async () => {
  const html = await render(play({ status: "CLOSED", peak: -12 }));
  assert.match(html, />pk -12%</);
});

// ── Entry/generation-time chip ─────────────────────────────────────────────────────────
test("row shows the ET flag time when firstFlaggedAt is present", async () => {
  const html = await render(play({ firstFlaggedAt: "2026-08-03T09:42:00-04:00" }));
  assert.match(html, /nh-deck-cbadge time/);
  assert.match(html, />09:42 ET</);
});

test("row omits the time chip when firstFlaggedAt is absent — never fabricates a time", async () => {
  const html = await render(play({ firstFlaggedAt: null }));
  assert.doesNotMatch(html, /nh-deck-cbadge time/);
});

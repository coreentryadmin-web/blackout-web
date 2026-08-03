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

// ── Peak-excursion as the PRIMARY closed-row number (the "looks like a pure loser" fix) ──
// A closed play's current mark/mid is dead information — nobody trades it anymore. The peak
// excursion it reached before the stop is the honest "what actually happened" story, so it
// replaces the dead price/pnl% entirely on a CLOSED row instead of riding along as a small chip.
test("closed row with a peak that ran green before stopping out shows PEAK as the primary number", async () => {
  const html = await render(play({ status: "CLOSED", peak: 87, pnlPct: -50 }));
  assert.match(html, />\+87%</);
  assert.match(html, />PEAK</);
});

test("closed row never shows the dead mid price/MID label — peak replaces it, not augments it", async () => {
  const html = await render(play({ status: "CLOSED", peak: 87, mark: 1.57 }));
  assert.doesNotMatch(html, />MID</);
  assert.doesNotMatch(html, /\$1\.57/);
});

test("open row (not yet closed) still shows the live mid price, not peak", async () => {
  const html = await render(play({ status: "OPEN", peak: 87 }));
  assert.doesNotMatch(html, />PEAK</);
  assert.match(html, />MID</);
});

test("closed row with no peak data (older/degraded row) falls back to the normal mid/pnl display, never fabricates a peak", async () => {
  const html = await render(play({ status: "CLOSED", peak: null, mark: 1.57, pnlPct: -50 }));
  assert.doesNotMatch(html, />PEAK</);
  assert.match(html, /\$1\.57/);
});

test("negative peak renders without a stray '+' sign", async () => {
  const html = await render(play({ status: "CLOSED", peak: -12 }));
  assert.match(html, />-12%</);
  assert.doesNotMatch(html, />\+-12%</);
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

// ── Row simplification: tier/origin/thesis-health/staleness/exec-fill move to the right
// pane only — the list row stays down to ticker/contract/status/the one number/timestamp.
test("row omits tier, origin, thesis-health, and stale badges — those live in the right pane only", async () => {
  const html = await render(
    play({
      status: "OPEN",
      tierLabel: "A",
      discoveryOrigin: ["BREAKOUT"],
      thesisHealth: {
        health: 80,
        entryIndex: 80,
        currentIndex: 80,
        delta: 0,
        rung: "intact",
        rungLabel: "intact",
        pillars: [],
        moves: [],
        committedAtEt: null,
        computedAtEt: "10:00",
        advisory: "hold",
        thesisBreakLevel: "intact",
        thesisBreakNote: "",
      },
    })
  );
  assert.doesNotMatch(html, /nh-deck-cbadge tier/);
  assert.doesNotMatch(html, /nh-deck-cbadge orig/);
  assert.doesNotMatch(html, /nh-deck-th-chip/);
  assert.doesNotMatch(html, /nh-deck-cbadge stale/);
});

test("row omits the exec-fill line — plain pnl% is the whole story on the row", async () => {
  const html = await render(play({ status: "OPEN", pnlPct: 12, execPnlPct: 9 }));
  assert.doesNotMatch(html, /nh-deck-cardexec/);
  assert.doesNotMatch(html, />fill /);
});

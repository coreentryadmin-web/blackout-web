import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

// Classic JSX runtime in this test context expects a global React (same idiom as
// PlaybookBoard.test.ts) — set it BEFORE importing the component.
(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./PlayTerminal");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "182C · 0DTE",
    occ: "NVDA260725C00182000",
    score: 80,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [{ label: "Flow", points: 12 }],
    gates: [{ label: "Hard gate", ok: true }],
    recommendation: "HOLD",
    entry: 2.0,
    mark: 2.6,
    pnlPct: 30,
    peak: 80,
    trough: -20,
    ...overrides,
  };
}

async function render(p: TerminalPlay | null, extraProps: Record<string, unknown> = {}): Promise<string> {
  const { PlayTerminal } = await load();
  return renderToStaticMarkup(React.createElement(PlayTerminal, { play: p, ...extraProps }));
}

// ── OCC one-tap copy control ───────────────────────────────────────────────────────────
test("OCC copy: control renders (accessible button, aria-label) when an OCC is on the row", async () => {
  const html = await render(play({ occ: "NVDA260725C00182000" }));
  assert.match(html, /nh-deck-occcopy/);
  assert.match(html, /aria-label="Copy OCC symbol NVDA260725C00182000"/);
  assert.match(html, /<button/); // a real, keyboard-focusable control
});

test("Play timeline tab renders for 0DTE horizon", async () => {
  const html = await render(
    play({
      firstFlaggedAt: "2026-08-03T11:20:00-04:00",
      pnlPct: 35,
      peak: 87,
    }),
  );
  assert.match(html, />\[4\]</);
  assert.match(html, />Timeline</);
});

test("premium thesis panels render for 0DTE", async () => {
  const html = await render(
    play({
      tierLabel: "A",
      thesisHealth: {
        health: 82,
        currentIndex: 92,
        advisory: "Thesis intact",
        pillars: [{ id: "flow", label: "Flow", status: "intact" }],
        committedAtEt: "10:15",
      },
    }),
  );
  assert.match(html, /nh-deck-conviction/);
  assert.match(html, /Thesis Strength/);
  assert.match(html, /Confluence/);
  assert.match(html, /Engine Checklist/);
});

test("Play timeline tab absent on Legacy horizon", async () => {
  const html = await render(play({ horizon: "LEGACY" }));
  assert.doesNotMatch(html, />Timeline</);
});

test("OCC copy: absent OCC → no control rendered (graceful, no dead button)", async () => {
  const html = await render(play({ occ: null }));
  assert.doesNotMatch(html, /nh-deck-occcopy/);
});

// ── "Why now" ribbon (Thesis tab is the default tab) ──────────────────────────────────
test("why-now ribbon: renders the trigger label + ET flag time when whyNow is present", async () => {
  const html = await render(
    play({
      whyNow: { reason: "accumulation", label: "multi-day accumulation (3d build)" },
      firstFlaggedAt: "2026-07-25T10:42:00-04:00",
    }),
  );
  assert.match(html, /nh-deck-whynow/);
  assert.match(html, /triggered by:/);
  assert.match(html, /multi-day accumulation \(3d build\)/);
  assert.match(html, /10:42 ET/);
});

test("why-now ribbon: omitted entirely when whyNow is absent (no fabricated reason)", async () => {
  const html = await render(play({ whyNow: null }));
  assert.doesNotMatch(html, /nh-deck-whynow/);
  assert.doesNotMatch(html, /triggered by:/);
});

// ── Wilson-CI scorecard badge ─────────────────────────────────────────────────────────
test("scorecard: win-rate renders WITH the Wilson CI when the payload carries it", async () => {
  const html = await render(play({ scorecard: { winRate: 63, avg: 12, n: 214, ciLow: 55, ciHigh: 70 } }));
  assert.match(html, /63% WR \(95% CI 55–70%, n=214\)/);
});

test("scorecard: CI absent → explicit 'CI n/a', never a bare point estimate", async () => {
  const html = await render(play({ scorecard: { winRate: 63, avg: 12, n: 214 } }));
  assert.match(html, /63% WR \(n=214 · CI n\/a\)/);
});

test("scorecard: non-finite win-rate (n=0) renders '— WR', never 'NaN% WR'", async () => {
  const html = await render(play({ scorecard: { winRate: Number.NaN, avg: 0, n: 0 } }));
  assert.match(html, /— WR \(n=0 · CI n\/a\)/);
  assert.doesNotMatch(html, /NaN/);
});

// ── nowMs prop (shared clock from CommandDeck — avoids a duplicate 1Hz timer) ─────────
test("nowMs prop: an injected clock drives staleness detection instead of the component's own tick", async () => {
  const markAsOf = new Date("2026-07-25T10:00:00-04:00").toISOString();
  // Fresh at the mark's own instant — nowMs == markAsOf should NOT read stale.
  const freshHtml = await render(play({ markAsOf, status: "OPEN" }), { nowMs: Date.parse(markAsOf) });
  assert.doesNotMatch(freshHtml, /STALE/);

  // Same play, clock pushed 5 minutes past markAsOf via the injected prop (not real time) — must
  // read stale, proving the render used the injected nowMs rather than Date.now()/its own tick.
  const staleHtml = await render(play({ markAsOf, status: "OPEN" }), {
    nowMs: Date.parse(markAsOf) + 5 * 60_000,
  });
  assert.match(staleHtml, /STALE/);
});

test("nowMs prop: omitted → renders without throwing (falls back to the component's own tick)", async () => {
  const html = await render(play({ markAsOf: new Date().toISOString(), status: "OPEN" }));
  assert.match(html, /<div/); // sanity: still produces real markup, not a crash
});

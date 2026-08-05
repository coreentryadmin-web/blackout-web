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
    { convictionRank: { rank: 1, total: 18, isHighestToday: true } },
  );
  assert.match(html, /nh-deck-trade-hero-dense/);
  assert.match(html, /nh-deck-conf-badge/);
  assert.match(html, /nh-deck-trade-hero__metrics/);
  assert.match(html, />Current</);
  assert.match(html, />Peak</);
  assert.match(html, />Rank</);
  assert.match(html, /#1/);
  assert.match(html, /Highest today/);
});

test("Play timeline tab absent on Legacy horizon", async () => {
  const html = await render(play({ horizon: "LEGACY" }));
  assert.doesNotMatch(html, />Timeline</);
});

// ── Confidence/Conviction/Thesis-Strength dedup (Night Hawk panel declutter, docs/audit/FINDINGS.md
// 2026-08-05, Issue A) — one canonical "Thesis Strength" number, one canonical place (the hero). ──
test("hero: the live metrics tile shows the canonical 'Thesis Strength' label + thesisHealth.health value", async () => {
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
  assert.match(html, />Thesis Strength</);
  // The old "Confidence" metric-tile label is gone from the hero's metrics row (the badge in the
  // headrow still legitimately says "Confidence" in its aria-label — a DIFFERENT, static measure —
  // so this asserts the metrics-row label specifically, not the string "Confidence" globally).
  assert.doesNotMatch(html, /<span className="k">Confidence<\/span>/);
  // Renders the LIVE thesis-health number (82), not the static score/grade fallback.
  const metricsSection = html.slice(html.indexOf("nh-deck-trade-hero__metrics"));
  assert.match(metricsSection.slice(0, metricsSection.indexOf("nh-deck-trade-hero__age")), />82</);
});

test("hero: Thesis Strength falls back to the entry-quality score when no thesisHealth is wired (e.g. WATCH/Legacy)", async () => {
  const html = await render(play({ thesisHealth: null, score: 80 }));
  assert.match(html, />Thesis Strength</);
  assert.match(html, />80</);
});

test("Management tab: no longer renders the Entry-plan Contract/Current-mark trio for a committed 0DTE play (dupes the header/hero)", async () => {
  const html = await render(
    play({ optionsPlay: "NVDA260725C00182000", rrRatio: 2.4 }),
    {},
  );
  assert.doesNotMatch(html, /Current mark/);
});

test("Thesis tab: R:R ratio now appears in the commit-snapshot meta grid (folded in from the removed Entry-plan block)", async () => {
  const html = await render(play({ rrRatio: 2.4 }));
  assert.match(html, /Risk : Reward/);
  assert.match(html, /2\.4:1/);
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

// ── Scorecard badge (avg return only — no win rate on Night Hawk) ───────────────────
test("scorecard: renders average return and sample size without win rate", async () => {
  const html = await render(play({ scorecard: { winRate: 63, avg: 12, n: 214, ciLow: 55, ciHigh: 70 } }));
  assert.match(html, /\+12% avg · n=214/);
  assert.doesNotMatch(html, /WR/);
});

test("scorecard: non-finite avg still shows sample size, never NaN", async () => {
  const html = await render(play({ scorecard: { winRate: Number.NaN, avg: 0, n: 0 } }));
  assert.match(html, /0% avg · n=0/);
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

// ── Legacy stop/target distance dedup (2026-08-05) ─────────────────────────────────────
// Before the fix, a Legacy play's stop/target distance rendered 3x: the Thesis meta grid (bare
// levels), LegacyManageGeometry (Management tab — levels + live $/% distance + entry-zone track +
// zone label), and LegacyPnlPanel (PnL tab — a second, identical levels + $/% distance grid, plus a
// second marker-less STOP/TARGET track). Fix keeps exactly one rendering — LegacyManageGeometry,
// the richest treatment — and strips the other two down to what's genuinely unique to them.
function legacyPlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "LEGACY:AAPL",
    ticker: "AAPL",
    direction: "LONG",
    contract: "shares",
    score: 70,
    status: "OPEN",
    horizon: "LEGACY",
    exitModel: "PLAN",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 190,
    mark: null,
    pnlPct: 4.2,
    stockPrice: 198,
    stockChangePct: 1.1,
    entryRange: "$192.50 – $195.00",
    targetLevel: "$210",
    stopLevel: "$185",
    progress: 0.6,
    ...overrides,
  } as TerminalPlay;
}

test("Legacy Thesis tab: no longer shows the bare entry range/target/stop meta rows (moved to Management)", async () => {
  const html = await render(legacyPlay());
  assert.doesNotMatch(html, />Entry range</);
  // "Target"/"Stop" labels are Legacy-only meta-grid rows (k/v spans) — assert the specific
  // labeled rows are gone, not the words in general (which still appear on other tabs/foot).
  assert.doesNotMatch(html, /<span class="k">Target<\/span>/);
});

test("Legacy Management tab: LegacyManageGeometry is the sole stop/target distance + entry-zone track", async () => {
  const html = await render(legacyPlay(), { initialTab: "manage" });
  assert.match(html, /\$210/); // target level
  assert.match(html, /\$185/); // stop level
  assert.match(html, /nh-deck-entry-zone/); // entry-zone marker on the track — the richest cue
  assert.match(html, /mid-range — hold per plan/); // zone label derived from progress
  // Distance-to-level ($ / %) computed from stockPrice vs target/stop.
  assert.match(html, /nh-deck-dist/);
});

test("Legacy PnL tab: keeps stock quote + day-change, drops the duplicate stop/target grid + track", async () => {
  const html = await render(legacyPlay(), { initialTab: "pnl" });
  assert.match(html, /\$198\.00/); // stock quote still shown
  assert.match(html, /day change/); // day-change line still shown
  // The duplicate labeled Target/Stop rows and the marker-less STOP/TARGET track are gone.
  assert.doesNotMatch(html, /<span class="k">Target<\/span>/);
  assert.doesNotMatch(html, /<span class="k">Stop<\/span>/);
  assert.doesNotMatch(html, /nh-deck-track/);
});

test("Legacy PnL tab: unrelated fields (IV rank, R:R, contract) survive the dedup", async () => {
  const html = await render(
    legacyPlay({ ivRank: 42, rrRatio: 2.5, optionsPlay: "AAPL 210C 9/19" }),
    { initialTab: "pnl" },
  );
  assert.match(html, />42</);
  assert.match(html, /2\.5:1/);
  assert.match(html, /AAPL 210C 9\/19/);
});

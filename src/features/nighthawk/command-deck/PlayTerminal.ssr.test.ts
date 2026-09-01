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

// ── OCC one-tap copy control ───────────────────────────────────────────────────────────
test("OCC copy: control renders (accessible button, aria-label) when an OCC is on the row", async () => {
  const html = await render(play({ occ: "NVDA260725C00182000" }));
  assert.match(html, /nh-deck-occcopy/);
  assert.match(html, /aria-label="Copy OCC symbol NVDA260725C00182000"/);
  assert.match(html, /<button/); // a real, keyboard-focusable control
});

test("Swing OPEN play: tabbed terminal defaults to Thesis at first paint (SSR)", async () => {
  const html = await render(
    play({
      horizon: "SWING",
      status: "OPEN",
      contract: "180C · 5DTE",
      factors: [{ label: "Flow", points: 10 }],
    }),
  );
  assert.match(html, /nh-deck-tabs/);
  assert.match(html, />\[1\]<\/span>Thesis/);
  assert.match(html, /Why this play was picked/);
  assert.doesNotMatch(html, /nh-deck-command-panel/);
  // Management-only trim ladder headline must not be the default tab body.
  assert.doesNotMatch(html, /Trim-scale ladder — the engine banks partials/);
});

test("0DTE single panel v2: verdict band, evidence stack, collapsed technicals", async () => {
  const html = await render(
    play({
      firstFlaggedAt: "2026-08-03T11:20:00-04:00",
      pnlPct: 35,
      peak: 87,
      // Full ThesisHealthPayload shape required (not just the fields each test happens to
      // assert on) now that ThesisHealthPanel actually renders it inside ZeroDteCommandPanel —
      // `rung`/`moves` are read unconditionally (rung.replace, moves.map) with no null guard,
      // since the real payload from thesis-health.ts always populates them.
      thesisHealth: {
        health: 82,
        currentIndex: 92,
        advisory: "Thesis intact",
        pillars: [{ id: "flow", label: "Flow", status: "intact" }],
        committedAtEt: "10:15",
        rung: "INTACT",
        moves: [],
      },
    }),
  );
  assert.match(html, /nh-deck-command-panel-v2/);
  assert.match(html, /nh-deck-verdict-band/);
  assert.match(html, />Why we picked it</);
  assert.match(html, />Live · management</);
  assert.match(html, />Technicals · gates · factors</);
  assert.match(html, />Session log</);
  assert.doesNotMatch(html, /nh-deck-tabs/);
  assert.doesNotMatch(html, />\[4\]</);
  // v2 drops stacked legacy tab bodies — no duplicate Engine Checklist in default OPEN view.
  assert.doesNotMatch(html, /Engine Checklist/);
  // Technicals collapsed by default on OPEN working plays.
  assert.doesNotMatch(html, /<details class="nh-deck-command-technicals" open="">/);
});

test("DeskEvidenceStack renders in 0DTE command panel when thesisFirst is present", async () => {
  const html = await render(
    play({
      thesisFirst: {
        thesis: {
          ticker: "NVDA",
          direction: "long",
          rail_scores: { FLOW: 88, BREAKOUT: 84 },
          rails_fired: ["FLOW", "BREAKOUT"],
          systems_aligned: 2,
          trade_archetype: "BREAKOUT",
          archetype_score: 82,
          structural_state: "TRIGGERED",
          trigger_price: 181.5,
          summaries: { FLOW: "campaign", BREAKOUT: "triggered" },
          disagreeing_rails: [],
        },
        archetype_gates: { verdict: "PASS", archetype: "BREAKOUT", blocks: [], notes: [] },
        expression: null,
        rank_tier: "A",
      },
    }),
  );
  assert.match(html, /nh-deck-evidence-stack/);
  assert.match(html, />HELIX</);
  assert.match(html, />THERMAL</);
  assert.doesNotMatch(html, /nh-deck-thesis-rank/);
  assert.doesNotMatch(html, />Contract</);
});

test("premium thesis panels render for 0DTE", async () => {
  const html = await render(
    play({
      tierLabel: "A",
      // Full ThesisHealthPayload shape required (not just the fields each test happens to
      // assert on) now that ThesisHealthPanel actually renders it inside ZeroDteCommandPanel —
      // `rung`/`moves` are read unconditionally (rung.replace, moves.map) with no null guard,
      // since the real payload from thesis-health.ts always populates them.
      thesisHealth: {
        health: 82,
        currentIndex: 92,
        advisory: "Thesis intact",
        pillars: [{ id: "flow", label: "Flow", status: "intact" }],
        committedAtEt: "10:15",
        rung: "INTACT",
        moves: [],
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
  assert.doesNotMatch(html, />Session log</);
});

test("Legacy single panel v2: why picked, what to watch, no tab bar", async () => {
  const html = await render(
    legacyPlay({
      thesis: "Bullish breakout above prior resistance with flow confirmation.",
      targetAtrMultiple: 1.1,
      tierLabel: "A",
      rank: 2,
      morningStatus: "CONFIRMED",
      factors: [{ label: "Flow", points: 14 }, { label: "Technicals", points: 9 }],
    }),
  );
  assert.match(html, /nh-deck-legacy-panel/);
  assert.match(html, />Why we picked it</);
  assert.match(html, />What to watch</);
  assert.match(html, />How to express it</);
  assert.match(html, /comparable setups traded that far within the next session/);
  assert.doesNotMatch(html, /nh-deck-tabs/);
  assert.doesNotMatch(html, />\[1\]<\/span>Thesis/);
});

// ── Confidence/Conviction/Thesis-Strength dedup (Night Hawk panel declutter, docs/audit/FINDINGS.md
// 2026-08-05, Issue A) — one canonical "Thesis Strength" number, one canonical place (the hero). ──
test("hero: the live metrics tile shows the canonical 'Thesis Strength' label + thesisHealth.health value", async () => {
  const html = await render(
    play({
      tierLabel: "A",
      // Full ThesisHealthPayload shape required (not just the fields each test happens to
      // assert on) now that ThesisHealthPanel actually renders it inside ZeroDteCommandPanel —
      // `rung`/`moves` are read unconditionally (rung.replace, moves.map) with no null guard,
      // since the real payload from thesis-health.ts always populates them.
      thesisHealth: {
        health: 82,
        currentIndex: 92,
        advisory: "Thesis intact",
        pillars: [{ id: "flow", label: "Flow", status: "intact" }],
        committedAtEt: "10:15",
        rung: "INTACT",
        moves: [],
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

test("Thesis tab: R:R ratio appears in technicals when expanded (CLOSED play)", async () => {
  const html = await render(play({ rrRatio: 2.4, status: "CLOSED" }));
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

// ── Legacy single-panel rail (2026-09) ───────────────────────────────────────────────────

test("Legacy single panel: levels + progress track live under What to watch", async () => {
  const html = await render(legacyPlay({ rank: 1 }));
  assert.match(html, />\$210/);
  assert.match(html, /\$185/);
  assert.match(html, /nh-deck-entry-zone/);
  assert.match(html, /mid-range — hold per plan/);
  assert.match(html, /nh-deck-dist/);
});

test("Legacy single panel: stock move uses from-entry label in header stream", async () => {
  const html = await render(legacyPlay({ stockMovePct: 4.2, pnlPct: 4.2 }));
  assert.match(html, /4\.2% from entry/);
  assert.match(html, /stock entry/);
});

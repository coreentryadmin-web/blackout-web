import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";

(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./TerminalPremiumPanels");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "182C · 0DTE",
    occ: "NVDA260725C00182000",
    score: 80,
    status: "CLOSED",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 2,
    mark: 1,
    pnlPct: -50,
    peak: 14,
    trough: -50,
    exitPnlPct: -50,
    ...overrides,
  };
}

test("TradeExcursionGraphic renders entry-centered MAE/MFE bar (stats row only, no journey chart)", async () => {
  const { TradeExcursionGraphic } = await load();
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, { play: play() }),
  );
  assert.match(html, /nh-deck-excursion-graphic/);
  assert.match(html, /Worst/);
  assert.match(html, /Entry/);
  assert.match(html, /Best/);
  assert.match(html, /Close/);
  assert.match(html, /-50%/);
  assert.match(html, /\+14%/);
  // Night Hawk panel declutter (docs/audit/FINDINGS.md, 2026-08-04): the SVG "journey" line
  // chart re-plotted the same Entry/Peak/Current values a 3rd/4th time alongside the hero and
  // this stats row — removed. The stats row above is kept (the "1-2 renderings max" middle
  // ground), the redundant SVG spine must never come back.
  assert.doesNotMatch(html, /nh-deck-excursion-graphic__journey/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-24): the "Close" stat used to be a standalone
// `play.exitPnlPct ?? play.pnlPct` ternary — a simpler reimplementation of closedRealizedPct()
// (play-card-lifecycle.ts) that skipped the as-managed trim-scale blend for a `closedReason:
// "stopped"` row with armed trim tranches and no recorded `exitPnlPct`. The default fixture above
// happens to set `exitPnlPct === pnlPct`, so it could never exercise this path — every real
// payload with the gap looks identical to one without it under that fixture. This case pins the
// exact repro: `peak: 87.3` is the same value play-card-lifecycle.test.ts's own
// "closedRealizedPct: trim-scale as-managed when peak armed tranches before runner stop" case
// uses, confirming closedRealizedPct(this exact play) resolves to +6.67%, not the raw -50% stop
// pin the old ternary would have shown.
test("TradeExcursionGraphic: Close stat uses the trim-scale as-managed blend for a stopped row with no exit stamp, not the raw mechanical stop pin", async () => {
  const { TradeExcursionGraphic } = await load();
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, {
      play: play({ exitPnlPct: null, closedReason: "stopped", peak: 87.3, pnlPct: -50 }),
    }),
  );
  const closeStat = html.match(/<span class="k">Close<\/span>\s*<span[^>]*>([^<]*)<\/span>/);
  assert.ok(closeStat, "expected a Close stat in the stats row");
  assert.equal(closeStat![1], "+6.7%", "Close stat must show the blended as-managed outcome, not the raw -50% mechanical stop pin");
});

// BUG FIX (Ask Largo standing mandate — live-audit confirmed finding, 2026-11-09): a sibling
// instance of the within-panel-contradiction class the test above pins for the CLOSED case,
// left open for a still-OPEN SWING TRIM row. Fixture mirrors the live APP repro from #7834 exactly
// (ZeroDteCommandPanel.test.ts's "verdict band shows the BLENDED P&L..." block): entry $17.34,
// mark $98.00 → raw runner-only P&L +465.2%, one tranche fired at the +100%/50% rung → blended =
// 0.5×100 + 0.5×465.2 = +282.6%, which formatExcursionPct (whole-percent above 10%) renders "+283%".
test("TradeExcursionGraphic: Current stat uses the BLENDED whole-position P&L for an OPEN SWING position with an already-banked trim, not the raw open-runner-only figure", async () => {
  const { TradeExcursionGraphic } = await load();
  const trimLadder: TerminalExitLadder = {
    policy: "trim_scale",
    hard_stop_pct: -60,
    target_pct: 100,
    trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 34.68, fired: true }],
    runner_fraction: 0.5,
    stop_premium: 6.94,
    target_premium: 34.68,
    time_stop_et: "16:00",
  };
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, {
      play: play({
        id: "SWING:APP:2397",
        ticker: "APP",
        horizon: "SWING",
        status: "TRIM",
        exitModel: "SCALE_OUT",
        entry: 17.34,
        mark: 98.0,
        pnlPct: 465.2,
        peak: 465.2,
        trough: 0,
        exitPnlPct: null,
        closedReason: undefined,
        exitPolicy: trimLadder,
      }),
    }),
  );
  const currentStat = html.match(/<span class="k">Current<\/span>\s*<span[^>]*>([^<]*)<\/span>/);
  assert.ok(currentStat, "expected a Current stat in the stats row");
  assert.equal(
    currentStat![1],
    "+283%",
    "Current stat must show the blended whole-position P&L (50% banked @ +100% + 50% of the open runner's +465.2%), matching the verdict band fixed by #7834 — not the raw +465% open-runner-only figure",
  );
});

test("TradeExcursionGraphic: a fully-OPEN SWING position with NO banked trim (all trim_levels unfired) is unaffected — still shows the raw figure", async () => {
  const { TradeExcursionGraphic } = await load();
  const trimLadder: TerminalExitLadder = {
    policy: "trim_scale",
    hard_stop_pct: -60,
    target_pct: 100,
    trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 34.68, fired: false }],
    runner_fraction: 0.5,
    stop_premium: 6.94,
    target_premium: 34.68,
    time_stop_et: "16:00",
  };
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, {
      play: play({
        horizon: "SWING",
        status: "OPEN",
        entry: 17.34,
        mark: 24.74,
        pnlPct: 42.6,
        peak: 42.6,
        trough: 0,
        exitPnlPct: null,
        closedReason: undefined,
        exitPolicy: trimLadder,
      }),
    }),
  );
  const currentStat = html.match(/<span class="k">Current<\/span>\s*<span[^>]*>([^<]*)<\/span>/);
  assert.ok(currentStat, "expected a Current stat in the stats row");
  assert.equal(currentStat![1], "+43%", "no tranche has fired — blendedTrimPnlPct must no-op and the raw figure must still render");
});

test("TradeExcursionGraphic: a ZERO_DTE TRIM row is unaffected (fix is scoped to SWING only) — still shows the raw figure even with a fired trim tranche", async () => {
  const { TradeExcursionGraphic } = await load();
  const trimLadder: TerminalExitLadder = {
    policy: "trim_scale",
    hard_stop_pct: -60,
    target_pct: 100,
    trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 34.68, fired: true }],
    runner_fraction: 0.5,
    stop_premium: 6.94,
    target_premium: 34.68,
    time_stop_et: "16:00",
  };
  const html = renderToStaticMarkup(
    React.createElement(TradeExcursionGraphic, {
      play: play({
        horizon: "ZERO_DTE",
        status: "TRIM",
        entry: 17.34,
        mark: 98.0,
        pnlPct: 465.2,
        peak: 465.2,
        trough: 0,
        exitPnlPct: null,
        closedReason: undefined,
        exitPolicy: trimLadder,
      }),
    }),
  );
  const currentStat = html.match(/<span class="k">Current<\/span>\s*<span[^>]*>([^<]*)<\/span>/);
  assert.ok(currentStat, "expected a Current stat in the stats row");
  assert.equal(
    currentStat![1],
    "+465%",
    "this fix is deliberately scoped to SWING only — a 0DTE TRIM row's pnlPct comes from a different server-side path not touched here",
  );
});

test("ThesisChecklistPanel: merges pillar checks under one taxonomy, no duplicate Flow/Breadth/Gamma rows", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({
        thesisHealth: {
          health: 82,
          currentIndex: 92,
          advisory: "Thesis intact",
          pillars: [
            { id: "flow", label: "Flow", status: "intact" },
            { id: "dealer", label: "Dealer", status: "intact" },
            { id: "vwap", label: "VWAP", status: "intact" },
            { id: "market", label: "Breadth", status: "intact" },
            { id: "structure", label: "Gamma", status: "faded" },
            { id: "volatility", label: "Vol", status: "lost" },
          ],
          committedAtEt: "10:15",
        },
      }),
    }),
  );
  assert.match(html, /Engine Checklist/);
  for (const label of ["Dealer", "Flow", "VWAP", "Breadth", "Gamma", "Vol", "Momentum"]) {
    const count = (html.match(new RegExp(`>${label}<`, "g")) ?? []).length;
    assert.equal(count, 1, `expected exactly one "${label}" row, got ${count}`);
  }
});

test("ThesisChecklistPanel: renders tier-factor breakdown for Legacy plays (no pillar data)", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({
        horizon: "LEGACY",
        thesisHealth: null,
        tierLabel: "A",
        tierFactors: [
          { label: "Prime score band", direction: "up", detail: "Score in the top decile." },
          { label: "Strong signal breadth", direction: "up", detail: "3+ confirming signals." },
        ],
      }),
    }),
  );
  assert.match(html, /Merit tier/);
  assert.match(html, /Prime score band/);
  assert.match(html, /Strong signal breadth/);
});

test("ThesisChecklistPanel: renders nothing when neither pillar nor tier data is present", async () => {
  const { ThesisChecklistPanel } = await load();
  const html = renderToStaticMarkup(
    React.createElement(ThesisChecklistPanel, {
      play: play({ thesisHealth: null, tierFactors: null }),
    }),
  );
  assert.equal(html, "");
});

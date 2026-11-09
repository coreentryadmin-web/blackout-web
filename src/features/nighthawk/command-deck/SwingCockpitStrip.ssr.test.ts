import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalPlay } from "./types";

(globalThis as unknown as { React: typeof React }).React = React;

const load = () => import("./SwingCockpitStrip");

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:APP",
    ticker: "APP",
    direction: "LONG",
    contract: "100C · SWING",
    occ: "APP260116C00100000",
    score: 80,
    status: "OPEN",
    horizon: "SWING",
    exitModel: "TRIM_SCALE",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 17.34,
    mark: 98,
    pnlPct: 465.2,
    peak: 465.2,
    trough: 0,
    ...overrides,
  };
}

function statValue(html: string, label: string): string | null {
  const escaped = label.replace(/&/g, "&amp;");
  const re = new RegExp(`<span class="ckh">${escaped}<\\/span>\\s*<span[^>]*><b>([^<]*)<\\/b><\\/span>`);
  const m = html.match(re);
  return m ? m[1] : null;
}

// BUG FIX (Ask Largo standing mandate — live-audit follow-up to #7834/#7840, 2026-11-09): the
// "Session P&L" cockpit stat averaged raw play.pnlPct across OPEN/HOLD/TRIM SWING plays, never
// blending an already-banked trim tranche. Repro mirrors #7834/#7840's own live fixture exactly:
// entry $17.34, mark $98.00, one tranche fired at the +100%/50% rung -> raw runner-only P&L
// +465.2%, blended = 0.5*100 + 0.5*465.2 = +282.6%.
test("SwingCockpitStrip: Session P&L averages the BLENDED trim figure for a TRIM SWING play, not the raw open-runner P&L", async () => {
  const { SwingCockpitStrip } = await load();
  const trimPlay = play({
    status: "TRIM",
    pnlPct: 465.2,
    exitPolicy: {
      stop_premium: null,
      target_premium: null,
      trim_levels: [{ trigger_pct: 100, fraction: 0.5, fired: true }],
    } as unknown as TerminalPlay["exitPolicy"],
  });
  const html = renderToStaticMarkup(
    React.createElement(SwingCockpitStrip, { plays: [trimPlay], scanAsOf: null, winRatePct: null }),
  );
  // Single play in the average -> the cockpit stat equals that play's own blended figure exactly.
  assert.equal(statValue(html, "Session P&L"), "+282.6%");
});

test("SwingCockpitStrip: Session P&L is unaffected (raw average) when no trim tranche has fired yet", async () => {
  const { SwingCockpitStrip } = await load();
  const openPlay = play({ status: "OPEN", pnlPct: 12.5, exitPolicy: null });
  const html = renderToStaticMarkup(
    React.createElement(SwingCockpitStrip, { plays: [openPlay], scanAsOf: null, winRatePct: null }),
  );
  assert.equal(statValue(html, "Session P&L"), "+12.5%");
});

test("SwingCockpitStrip: Session P&L does not blend a non-SWING (ZERO_DTE) TRIM play", async () => {
  const { SwingCockpitStrip } = await load();
  const zdtePlay = play({
    horizon: "ZERO_DTE",
    status: "TRIM",
    pnlPct: 465.2,
    exitPolicy: {
      stop_premium: null,
      target_premium: null,
      trim_levels: [{ trigger_pct: 100, fraction: 0.5, fired: true }],
    } as unknown as TerminalPlay["exitPolicy"],
  });
  const html = renderToStaticMarkup(
    React.createElement(SwingCockpitStrip, { plays: [zdtePlay], scanAsOf: null, winRatePct: null }),
  );
  // Must stay on the raw +465.2%, never blended for a non-SWING horizon.
  assert.equal(statValue(html, "Session P&L"), "+465.2%");
});

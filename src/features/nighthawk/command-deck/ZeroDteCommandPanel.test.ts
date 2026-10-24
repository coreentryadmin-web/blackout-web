import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ZeroDteCommandPanel } from "./ZeroDteCommandPanel.tsx";
import type { TerminalPlay } from "./types.ts";
import type { ThesisHealthPayload } from "@/lib/zerodte/thesis-health";

(globalThis as unknown as { React: typeof React }).React = React;

const base: TerminalPlay = {
  id: "0DTE:NVDA",
  ticker: "NVDA",
  direction: "LONG",
  contract: "220C · 0DTE",
  score: 91,
  status: "OPEN",
  horizon: "ZERO_DTE",
  exitModel: "RATCHET",
  factors: [],
  gates: [],
  recommendation: "HOLD",
  tierLabel: "A",
  entry: 3.12,
  mark: 4.45,
  pnlPct: 42.6,
};

const HEALTH: ThesisHealthPayload = {
  health: 84,
  entryIndex: 78,
  currentIndex: 74,
  delta: -4,
  rung: "MINOR",
  rungLabel: "Minor fade",
  pillars: [
    {
      id: "vwap",
      label: "VWAP",
      weight: 0.3,
      commitScore: 1,
      currentScore: 1,
      commitLabel: "Above",
      currentLabel: "Above",
      status: "intact",
      contributionPts: 30,
      deltaPts: 0,
    },
    {
      id: "momentum",
      label: "Momentum",
      weight: 0.2,
      commitScore: 0.9,
      currentScore: 0.6,
      commitLabel: "Strong",
      currentLabel: "Weakening",
      status: "faded",
      contributionPts: 12,
      deltaPts: -6,
    },
  ],
  moves: ["Momentum weakened since entry — RSI cooling off the highs."],
  committedAtEt: "2026-08-28 10:35 ET",
  computedAtEt: "11:20 ET",
  advisory: "Thesis mostly intact — momentum is the pillar to watch.",
  thesisBreakLevel: "intact",
  thesisBreakNote: "",
};

function render(play: TerminalPlay): string {
  return renderToStaticMarkup(React.createElement(ZeroDteCommandPanel, { play, nowMs: 0 }));
}

describe("ZeroDteCommandPanel — thesis integrity wiring", () => {
  it("renders the Thesis integrity section with the real health score/rung/pillars when thesisHealth is present", () => {
    const html = render({ ...base, thesisHealth: HEALTH });

    assert.match(html, /Thesis integrity/);
    assert.match(html, /THESIS HEALTH/);
    assert.match(html, /MINOR FADE|MINOR/i);
    assert.match(html, /84/); // health score
    assert.match(html, /VWAP/);
    assert.match(html, /Momentum/);
    assert.match(html, /Weakening/);
    assert.match(html, /momentum weakened since entry/i); // the "why health moved" line
  });

  it("never renders the Thesis integrity section when thesisHealth is absent (never a fabricated panel)", () => {
    const html = render({ ...base, thesisHealth: null });
    assert.doesNotMatch(html, /Thesis integrity/);
    assert.doesNotMatch(html, /THESIS HEALTH/);
  });

  it("WATCH-status candidates (thesisHealth never computed for them) never render the section either", () => {
    const html = render({ ...base, status: "WATCH", thesisHealth: undefined });
    assert.doesNotMatch(html, /Thesis integrity/);
  });
});

describe("ZeroDteCommandPanel — SWING thesis health honesty gate (live repro RBLU, 2026-09-15)", () => {
  const swingBase: TerminalPlay = { ...base, id: "SWING:RBLU:1", ticker: "RBLU", horizon: "SWING" };

  // Mirrors exactly what horizonPlayFromBangerPosition (banger-lane-merge.ts) stamps on every
  // banger_positions ledger row — same fingerprint thesisHealthUncalibrated() now detects via the
  // "market" (regime) pillar's currentLabel === "BREAKOUT · BANGER".
  const BANGER_UNCALIBRATED_HEALTH: ThesisHealthPayload = {
    ...HEALTH,
    pillars: [
      ...HEALTH.pillars,
      {
        id: "market",
        label: "Regime fit",
        weight: 0.15,
        commitScore: 0.75,
        currentScore: 0.75,
        commitLabel: "BREAKOUT · BANGER",
        currentLabel: "BREAKOUT · BANGER",
        status: "intact",
        contributionPts: 11,
        deltaPts: 0,
      },
    ],
  };

  it("never renders SwingThesisHealthPanel for a Banger-origin uncalibrated payload — this block used to gate on `thesisHealth != null` alone, missing the same calibration check every other consumer on this page applies", () => {
    const html = render({ ...swingBase, thesisHealth: BANGER_UNCALIBRATED_HEALTH });
    assert.doesNotMatch(html, /Swing thesis health/);
    assert.doesNotMatch(html, /THESIS HEALTH/);
  });

  it("still renders SwingThesisHealthPanel for a genuinely calibrated SWING position (never over-suppresses)", () => {
    const html = render({ ...swingBase, thesisHealth: HEALTH });
    assert.match(html, /Swing thesis health/);
    assert.match(html, /THESIS HEALTH/);
    assert.match(html, /84/);
  });
});

// BUG FIX (Ask Largo standing mandate, 2026-10-24): the verdict-band headline P&L and the RATCHET
// stop→target marker both used to read raw `play.pnlPct` even for a CLOSED row — the mechanical
// −50% stop pin a stopped-with-trim-armed row still carries — while the "Trade outcome" section
// lower on the SAME panel already showed the correct trim-scale as-managed blend via
// closedRealizedPct(). `peak: 87.3` is play-card-lifecycle.test.ts's own fixture for this exact
// repro, pinning closedRealizedPct(this play) at 6.67 (renders "+6.7%"), not the raw −50% stop.
describe("ZeroDteCommandPanel — verdict band + ratchet marker use the trim-scale as-managed blend for a stopped CLOSED row, not the raw mechanical stop pin", () => {
  const stoppedClosed: TerminalPlay = {
    ...base,
    status: "CLOSED",
    closedReason: "stopped",
    exitPnlPct: null,
    peak: 87.3,
    pnlPct: -50,
    progress: 0, // only gates showsRatchetTrack(); the marker's own position is recomputed in-component.
  };

  it("verdict-band headline shows the blended +6.7%, not the raw -50% mechanical stop", () => {
    const html = render(stoppedClosed);
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(band![1], "+6.7%", "verdict band must show the as-managed realized outcome, not the raw mechanical stop");
  });

  it("RATCHET track marker position reflects the blended outcome (~38%), not the raw stop (0%)", () => {
    const html = render(stoppedClosed);
    const marker = html.match(/class="mk" style="left:([0-9]+)%"/);
    assert.ok(marker, "expected a RATCHET track marker");
    assert.equal(marker![1], "38", "marker must be positioned from the blended realized P&L, not the raw -50% stop (which would read 0%)");
  });
});

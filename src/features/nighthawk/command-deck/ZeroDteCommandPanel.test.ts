import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ZeroDteCommandPanel } from "./ZeroDteCommandPanel.tsx";
import type { TerminalPlay } from "./types.ts";
import type { ThesisHealthPayload } from "@/lib/zerodte/thesis-health";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";

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

// BUG FIX (sign-bias rounding tie — Ask Largo / Night Hawk standing mandate, 2026-11-09): this
// panel's own local `signPct` combined a bare `Math.round(n)` with a separate `n > 0 ? "+" : ""`
// sign prefix. `Math.round()` always rounds a tie (`.5`) toward +Infinity, so a NEGATIVE value
// landing exactly on a .5 boundary rounds toward zero (i.e. its magnitude is UNDERSTATED) while a
// positive value at the same boundary rounds away from zero — e.g. `Math.round(-2.5) === -2` but
// `Math.round(2.5) === 3`. `trough` (always <= 0, the mechanical worst-excursion read) and
// `realizedPct`/`peak` (can be negative for a losing closed trade) are all formatted through this
// helper, so every negative %.5 reading on this panel silently prints one point smaller in
// magnitude than it should. This is the same bug class already fixed independently in
// fmt-money.ts's fmtPct, round-floats.ts, thermal/shift-math.ts, and PlayTerminal.tsx's own
// (differently-scoped, duplicate-named) `signPct` — this is a SEVENTH, previously-unfixed
// instance, in a sibling command-deck file PlayTerminal.tsx's own fix did not touch. Fix pattern
// is identical every time: `Math.sign(n) * Math.round(Math.abs(n))` instead of a bare
// `Math.round(n)`, which rounds the magnitude correctly regardless of sign and leaves exact
// integers and positive values untouched.
describe("ZeroDteCommandPanel — signPct does not understate negative magnitudes at the .5 rounding boundary", () => {
  it("renders trough -2.5% as -3% (correct magnitude), not -2% (sign-biased Math.round)", () => {
    const html = render({ ...base, trough: -2.5 });
    const trough = html.match(/Trough<\/span><span class="v nh-deck-neg">([^<]*)</);
    assert.ok(trough, "expected a Trough stat");
    assert.equal(trough![1], "-3%", "Math.round(-2.5) === -2 silently understates the real -2.5% magnitude");
  });

  it("still renders a positive peak -.5 boundary correctly (unaffected by the fix)", () => {
    const html = render({ ...base, status: "CLOSED", closedReason: "time_stop", peak: 2.5 });
    const peak = html.match(/Peak<\/span><span class="v nh-deck-pos">([^<]*)</);
    assert.ok(peak, "expected a Peak stat");
    assert.equal(peak![1], "+3%", "positive .5 boundary must round away from zero, same as before the fix");
  });
});

// BUG FIX (Ask Largo standing mandate — live-audit confirmed finding, 2026-11-09, live repro
// SWING:APP/positionId 2397): the verdict-band headline P&L for an OPEN/TRIM SWING position with
// an already-banked trim tranche showed the raw, unblended live P&L on the still-open runner leg
// only, with zero qualifier — even though Ask Largo's own play-brief for the identical position
// already computes and discloses the correct BLENDED figure (play-brief.ts's `blendedPnlPct`, now
// `blendedTrimPnlPct` in terminal-ladder.ts). Fixture mirrors the live APP repro exactly: entry
// $17.34, mark $98.00 → raw runner-only P&L +465.2%, one tranche fired at the SWING_SCALE_OUT_POLICY
// ladder's +100%/50% rung → blended = 0.5×100 + 0.5×465.2 = +282.6%, matching the real play-brief's
// own disclosed "Blended P&L (realized trim + open runner): +282.6%" for this exact position.
describe("ZeroDteCommandPanel — verdict band shows the BLENDED P&L for an OPEN SWING position with an already-banked trim, not the raw open-runner-only figure", () => {
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
  const swingTrim: TerminalPlay = {
    ...base,
    id: "SWING:APP:2397",
    ticker: "APP",
    horizon: "SWING",
    status: "TRIM",
    exitModel: "SCALE_OUT",
    entry: 17.34,
    mark: 98.0,
    pnlPct: 465.2, // raw open-runner-only P&L — live-plays.ts's livePnlPct(17.34, 98.00)
    exitPolicy: trimLadder,
  };

  it("shows the blended +282.6%, not the raw open-runner-only +465.2%", () => {
    const html = render(swingTrim);
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(
      band![1],
      "+282.6%",
      "verdict band must show the blended whole-position P&L (50% banked @ +100% + 50% of the open runner's +465.2%), matching Ask Largo's own play-brief for the identical position",
    );
  });

  it("a fully-OPEN SWING position with NO banked trim (all trim_levels unfired) is unaffected — still shows the raw figure", () => {
    const swingOpenNoTrim: TerminalPlay = {
      ...swingTrim,
      status: "OPEN",
      pnlPct: 42.6,
      exitPolicy: { ...trimLadder, trim_levels: [{ ...trimLadder.trim_levels[0]!, fired: false }] },
    };
    const html = render(swingOpenNoTrim);
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(
      band![1],
      "+42.6%",
      "nothing has fired yet — the runner-only figure IS the whole position; must not be blended",
    );
  });

  it("a SWING position with NO exit policy at all is unaffected — still shows the raw figure", () => {
    const html = render({ ...swingTrim, exitPolicy: undefined });
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(band![1], "+465.2%", "no exit policy to blend against — must fall back to the raw figure");
  });

  it("a CLOSED SWING position (even with a fired trim tranche) is unaffected — still uses closedRealizedPct, never this new blend path", () => {
    const swingClosed: TerminalPlay = {
      ...swingTrim,
      status: "CLOSED",
      closedReason: "time_stop",
      exitPnlPct: 282.6,
    };
    const html = render(swingClosed);
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(
      band![1],
      "+282.6%",
      "CLOSED must keep using closedRealizedPct's own exitPnlPct-first precedence, unchanged by this fix",
    );
  });

  it("a ZERO_DTE TRIM row is unaffected (fix is scoped to SWING only) — still shows the raw figure even with a fired trim tranche", () => {
    const zeroDteTrim: TerminalPlay = { ...swingTrim, horizon: "ZERO_DTE", id: "0DTE:APP" };
    const html = render(zeroDteTrim);
    const band = html.match(/nh-deck-verdict-band__pnl[^"]*">([^<]*)</);
    assert.ok(band, "expected a P&L stat in the verdict band");
    assert.equal(
      band![1],
      "+465.2%",
      "this fix is deliberately scoped to SWING only — a 0DTE TRIM row's pnlPct comes from a different server-side path not touched here",
    );
  });
});

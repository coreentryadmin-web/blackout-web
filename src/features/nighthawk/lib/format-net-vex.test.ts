import assert from "node:assert/strict";
import test from "node:test";
import { formatTickerDossierText } from "./format";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import type { PositioningSummary } from "./positioning";

// REGRESSION (5-engine live monitor / Ask Largo standing mandate): the "Net VEX" line in
// formatTickerDossierText combined a plain `Math.round(pos.net_vex)` with a RAW-value sign
// check (`pos.net_vex >= 0 ? "+" : ""`). `Math.round` ties toward +Infinity
// (`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`), so a negative net VEX sitting
// exactly on a whole-unit tie rendered a SMALLER magnitude ("Net VEX: -2") than the
// mirror-image positive value ("Net VEX: +3") would for the identical distance from zero —
// this text is fed verbatim into the Largo prompt/dossier a trader reads, so the understated
// negative magnitude reached the member-facing surface, not just an internal field. Same bug
// class already fixed in fmt-money.ts's fmtPct, round-floats.ts,
// thermal/lib/gex-heatmap/shift-math.ts's fmtShiftPercentForStrike, and this feature's own
// command-deck siblings (PlayTerminal.tsx / ZeroDteCommandPanel.tsx signPct) — this was an
// independent, un-migrated paste of the same formatter shape in the dossier-text builder.

function baseScored(): ScoredCandidate {
  return {
    ticker: "TEST",
    score: 50,
    direction: "long",
    flow_score: 0,
    tech_score: 0,
    pos_score: 0,
    news_score: 0,
    smart_money_score: 0,
    conviction: "moderate",
  };
}

function baseDossier(positioning: PositioningSummary | null): TickerDossier {
  return {
    ticker: "TEST",
    flows: [],
    flow_streak: { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" },
    strike_stacks: [],
    dark_pool: null,
    oi_change: [],
    iv_rank: null,
    iv_term: [],
    realized_vol: null,
    risk_reversal_skew: null,
    flow_by_expiry: [],
    positioning,
    congress_trades: [],
    congress_unusual: [],
    institutional_activity: [],
    predictions_signal: null,
    screener_confirmed: false,
    tech: null,
    news_headlines: [],
    catalysts: [],
    polygon_sentiment: [],
    analyst_summary: null,
    price_target: null,
    insider_buys: 0,
    sector: null,
    short_days_to_cover: null,
    fundamental_ratios: null,
    fundamental_signals: null,
    benzinga_price_target: null,
    trading_halt: false,
    fda_events: [],
    greek_flow: null,
  };
}

function netVexLine(netVex: number | null): string {
  const dossier = baseDossier({
    net_gex: 0,
    gex_king_strike: null,
    gamma_flip: null,
    gamma_regime: "unknown",
    net_vex: netVex,
    max_pain: null,
    negative_gamma: null,
    wall_summary: "n/a",
  });
  const text = formatTickerDossierText(dossier, baseScored());
  const line = text.split("\n").find((l) => l.startsWith("Net VEX:"));
  assert.ok(line, "expected a Net VEX line in the dossier text");
  return line!;
}

test("Net VEX: equal-magnitude positive/negative ties render the SAME magnitude", () => {
  assert.equal(netVexLine(2.5), "Net VEX: +3");
  assert.equal(netVexLine(-2.5), "Net VEX: -3"); // was "Net VEX: -2" pre-fix
  assert.equal(netVexLine(0.5), "Net VEX: +1");
  assert.equal(netVexLine(-0.5), "Net VEX: -1"); // was "Net VEX: -0" pre-fix
});

test("Net VEX: ordinary non-tie values round as expected", () => {
  assert.equal(netVexLine(12.4), "Net VEX: +12");
  assert.equal(netVexLine(-12.4), "Net VEX: -12");
  assert.equal(netVexLine(12.6), "Net VEX: +13");
  assert.equal(netVexLine(-12.6), "Net VEX: -13");
});

test("Net VEX: zero and null", () => {
  assert.equal(netVexLine(0), "Net VEX: 0");
  const dossier = baseDossier(null);
  const text = formatTickerDossierText(dossier, baseScored());
  assert.ok(!text.includes("Net VEX:"), "null positioning must omit the Net VEX line entirely");
});

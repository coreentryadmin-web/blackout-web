import { test } from "node:test";
import assert from "node:assert/strict";

import {
  directionFromCallPct,
  helixContribution,
  meridianContribution,
  nighthawkContribution,
  thermalContribution,
  vectorContribution,
} from "./product-adapters";
import { coverage, joinProductSignals } from "./cross-product";

test("the call-share deadband prevents manufactured disagreement around 50%", () => {
  // Without a band, two products straddling 50% read as a genuine split while measuring the same
  // balanced tape. 51% is not a bullish tape.
  assert.equal(directionFromCallPct(51), "neutral");
  assert.equal(directionFromCallPct(49), "neutral");
  assert.equal(directionFromCallPct(55), "bullish");
  assert.equal(directionFromCallPct(45), "bearish");
  assert.equal(directionFromCallPct(null), null);
});

test("helix derives direction from session skew and carries its evidence", () => {
  const c = helixContribution({ ticker: "SPX", session: { call_pct: 72, alert_count: 140 } });
  assert.equal(c.signal?.direction, "bullish");
  assert.ok(c.signal?.evidence.includes("session call share 72%"));
  assert.ok(c.signal?.evidence.includes("140 prints"));
});

test("an empty helix tape is an explained absence, not a neutral vote", () => {
  const c = helixContribution({ ticker: "SPX", empty_reason: "no_prints_in_window" });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /no_prints_in_window/);
});

test("THERMAL never casts a directional vote — dealer gamma has no direction", () => {
  // The live P0 (#2422): a regex over regime prose matched "support" and reported bullish on a
  // short-gamma book, 3 of 3 tickers inverted. Gamma is not on a directional axis at all.
  const c = thermalContribution({ thermal: { gamma_posture: "short", volatility_regime: "amplifying" } });
  assert.equal(c.signal, null, "thermal must not vote on direction");
  assert.match(String(c.missingReason), /not a directional measurement/);
  // Its real axis still travels, so the model can use it.
  assert.match(String(c.missingReason), /short/);
  assert.match(String(c.missingReason), /amplifying/);
});

test("VECTOR's no-baseline case is named, not reported as quiet", () => {
  const c = vectorContribution({ ticker: "SPX", has_baseline: false, signals: [] });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /no baseline yet/);
  // And the genuinely-quiet case is a DIFFERENT reason.
  const quiet = vectorContribution({ ticker: "SPX", has_baseline: true, signals: [] });
  assert.match(String(quiet.missingReason), /no pulse signals fired/);
  assert.notEqual(c.missingReason, quiet.missingReason);
});

test("vector derives direction from pulse tone", () => {
  const c = vectorContribution({
    ticker: "I:SPX",
    has_baseline: true,
    signals: [
      { tone: "bearish", line: "gamma flipped short at 7650" },
      { tone: "bearish", line: "magnet moved down to 7620" },
      { tone: "bullish", line: "put wall thickened" },
    ],
  });
  assert.equal(c.signal?.direction, "bearish");
  assert.equal(c.signal?.ticker, "SPX", "I:SPX must fold to the canonical root");
});

test("meridian sizes risk but does not point a direction — an expected move is symmetric", () => {
  const c = meridianContribution({ events: [{ expected_move_pct: 6.4 }] });
  assert.equal(c.signal, null);
  assert.match(String(c.missingReason), /symmetric expected move of 6.4%/);
  const none = meridianContribution({ events: [] });
  assert.match(String(none.missingReason), /no earnings or catalyst event/);
});

test("night hawk votes from what the desk actually committed", () => {
  const c = nighthawkContribution({
    ticker: "SPX",
    plays: [
      { ticker: "SPX", option_type: "PUT" },
      { ticker: "NVDA", option_type: "PUT" },
      { ticker: "QQQ", option_type: "CALL" },
    ],
  });
  assert.equal(c.signal?.direction, "bearish");
  const empty = nighthawkContribution({ plays: [] });
  assert.match(String(empty.missingReason), /no committed plays/);
});

test("every adapter survives a garbage payload rather than taking the read down", () => {
  // Five agents are rewriting these payloads concurrently. An adapter that throws would fail the
  // whole cross-product read instead of degrading one product.
  for (const fn of [helixContribution, thermalContribution, vectorContribution, meridianContribution, nighthawkContribution]) {
    for (const junk of [null, undefined, 42, "nope", [], { unexpected: true }]) {
      const c = fn(junk);
      assert.equal(c.signal, null);
      assert.ok(String(c.missingReason).length > 0, "an absence must always state a reason");
    }
  }
});

test("END TO END — a real split, with honest coverage", () => {
  // The shape tonight actually produces: helix and night hawk vote, thermal abstains by design,
  // vector has no baseline, meridian has no event.
  const read = joinProductSignals("SPX", [
    helixContribution({ ticker: "SPX", session: { call_pct: 71, alert_count: 140 } }),
    nighthawkContribution({ ticker: "SPX", plays: [{ ticker: "SPX", option_type: "PUT" }] }),
    thermalContribution({ thermal: { gamma_posture: "short", volatility_regime: "amplifying" } }),
    vectorContribution({ ticker: "SPX", has_baseline: false, signals: [] }),
    meridianContribution({ events: [] }),
  ]);

  assert.equal(read.verdict, "split");
  assert.equal(read.direction, null, "a split must not resolve to a direction");
  assert.deepEqual(read.reporting.sort(), ["helix", "nighthawk"]);
  assert.equal(coverage(read).label, "2/5 products reporting");
  // Each of the three absences says something DIFFERENT — no generic "unavailable".
  const reasons = read.missing.map((m) => m.reason);
  assert.equal(new Set(reasons).size, 3);
  assert.match(String(read.disagreement), /genuine disagreement/);
});

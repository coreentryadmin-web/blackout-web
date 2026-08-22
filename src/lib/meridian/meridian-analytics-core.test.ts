import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExpectedVsRealized,
  buildMacroCorrelationRail,
  buildOpexPinAccuracy,
  opexPinHeld,
} from "./meridian-analytics-core";
import { intradayReactionFromBars } from "./meridian-intraday-core";

test("intradayReactionFromBars: 60m move after 08:30 release", () => {
  const base = Date.parse("2026-07-10T12:30:00Z"); // 08:30 ET
  const bars = [
    { t: base, o: 100, h: 100.5, l: 99.5, c: 100 },
    { t: base + 30 * 60_000, o: 100, h: 101, l: 99, c: 101 },
    { t: base + 60 * 60_000, o: 101, h: 102, l: 100, c: 102 },
  ];
  const rx = intradayReactionFromBars(bars, "08:30");
  assert.equal(rx.release_price, 100);
  assert.equal(rx.move_pct_30, 1);
  assert.equal(rx.move_pct_60, 2);
});

test("buildMacroCorrelationRail: headline with avg session", () => {
  const rail = buildMacroCorrelationRail(
    [
      { date: "2026-01-01", label: "CPI", actual: 3, estimate: 3.1, prior: 3, spx_session_pct: -0.8, spx_next_day_pct: null, spx_intraday_60_pct: -0.5 },
      { date: "2026-02-01", label: "CPI", actual: 3, estimate: 3.1, prior: 3, spx_session_pct: -0.6, spx_next_day_pct: null, spx_intraday_60_pct: -0.4 },
    ],
    "CPI"
  );
  assert.equal(rail.sample_size, 2);
  assert.equal(rail.regime_tag, "risk_off");
  assert.match(rail.headline, /Last 2 CPI prints/);
});

test("opexPinHeld: within tolerance", () => {
  assert.equal(opexPinHeld(5000, 5010, 0.35), true);
  assert.equal(opexPinHeld(5000, 5100, 0.35), false);
});

test("buildOpexPinAccuracy", () => {
  const acc = buildOpexPinAccuracy([
    { date: "2026-06-20", spx_session_pct: 0.1, spx_next_day_pct: null, max_pain: 5000, spx_close: 5005, pin_held: true },
    { date: "2026-05-16", spx_session_pct: -0.2, spx_next_day_pct: null, max_pain: 4800, spx_close: 4900, pin_held: false },
  ]);
  assert.equal(acc.graded, 2);
  assert.equal(acc.held, 1);
  assert.equal(acc.accuracy_pct, 50);
});

test("buildExpectedVsRealized: under implied move", () => {
  // Third argument added: the ratio is only computed when both sides describe the SAME print.
  // The arithmetic under test is unchanged — see meridian-evr-same-event.test.ts for the gate.
  const ev = buildExpectedVsRealized(8, 3, true);
  assert.equal(ev.verdict, "under");
  assert.equal(ev.ratio, 0.38);
});

test("buildExpectedVsRealized: no verdict when the two sides are different prints", () => {
  // Measured on prod 2026-08-21: SMTC compared its UPCOMING print's 25.6% implied against the
  // 2026-05-26 print's -4.41% reaction and called it "under".
  const ev = buildExpectedVsRealized(25.6, -4.41, false);
  assert.equal(ev.verdict, "unknown");
  assert.equal(ev.ratio, null);
  assert.equal(ev.realized_move_pct, -4.41, "the reaction itself is still reported");
});

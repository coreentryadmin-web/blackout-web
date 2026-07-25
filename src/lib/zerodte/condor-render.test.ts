import { test } from "node:test";
import assert from "node:assert/strict";
import {
  condorGeometryFrom,
  condorTent,
  condorWinRateLine,
  type CondorGeometry,
} from "./condor-render.ts";

const GEOM: CondorGeometry = {
  spot: 6300,
  short_put: 6250,
  long_put: 6200,
  short_call: 6350,
  long_call: 6400,
  wing_pts: 50,
  net_credit: 420,
  max_loss: 4580,
  breach_lower: 6250,
  breach_upper: 6350,
  est_win_rate: 92,
  est_intraday_breach_pct: 18.7,
};

test("condorGeometryFrom: parses a full blob; falls back short_put/call → breach levels", () => {
  const g = condorGeometryFrom(GEOM);
  assert.ok(g);
  assert.equal(g!.breach_lower, 6250);
  assert.equal(g!.breach_upper, 6350);
  assert.equal(g!.net_credit, 420);
  assert.equal(g!.est_intraday_breach_pct, 18.7);

  // breach_* absent → derived from the short strikes.
  const g2 = condorGeometryFrom({ short_put: 100, short_call: 110, wing_pts: 5 });
  assert.equal(g2!.breach_lower, 100);
  assert.equal(g2!.breach_upper, 110);
});

test("condorGeometryFrom: fail-closed on a bad/absent/degenerate range → null (no fabricated tent)", () => {
  assert.equal(condorGeometryFrom(null), null);
  assert.equal(condorGeometryFrom(undefined), null);
  assert.equal(condorGeometryFrom("x"), null);
  assert.equal(condorGeometryFrom({}), null); // no strikes
  assert.equal(condorGeometryFrom({ short_put: 6300, short_call: 6300 }), null); // inverted/degenerate (lower !< upper)
  assert.equal(condorGeometryFrom({ short_put: 6350, short_call: 6250 }), null); // inverted
});

test("condorGeometryFrom: optional numeric fields degrade to null independently, never a guess", () => {
  const g = condorGeometryFrom({ short_put: 6250, short_call: 6350, net_credit: null, est_win_rate: "oops" });
  assert.ok(g);
  assert.equal(g!.net_credit, null);
  assert.equal(g!.est_win_rate, null);
  assert.equal(g!.est_intraday_breach_pct, null);
});

test("condorTent: spot centered → frac ~0.5, both rooms positive, not breached", () => {
  const t = condorTent(GEOM, 6300);
  assert.ok(Math.abs(t.spotFrac! - 0.5) < 1e-9);
  assert.equal(t.roomDown, 50); // 6300 - 6250
  assert.equal(t.roomUp, 50); // 6350 - 6300
  assert.equal(t.breached, false);
  assert.equal(t.widthPts, 100);
});

test("condorTent: spot through the lower short → breached, frac clamped to 0", () => {
  const t = condorTent(GEOM, 6240);
  assert.equal(t.breached, true);
  assert.equal(t.spotFrac, 0); // clamped, never < 0
  assert.ok(t.roomDown! < 0); // -10 (already past)
  assert.equal(t.roomUp, 110);
});

test("condorTent: spot at the upper short is breached (touching = defined loss); frac clamps to 1", () => {
  const t = condorTent(GEOM, 6350);
  assert.equal(t.breached, true); // >= breach_upper
  assert.equal(t.spotFrac, 1);
});

test("condorTent: no spot → null marker, null rooms, not breached (never a guessed position)", () => {
  const t = condorTent(GEOM, null);
  assert.equal(t.spotFrac, null);
  assert.equal(t.roomDown, null);
  assert.equal(t.roomUp, null);
  assert.equal(t.breached, false);
  assert.equal(t.widthPts, 100);
});

test("condorWinRateLine: WR always paired with breach rate; flags an unmeasured tail", () => {
  const both = condorWinRateLine({ est_win_rate: 92, est_intraday_breach_pct: 18.7 });
  assert.deepEqual(both, { winRate: 92, breachRatePct: 18.7, breachUnmeasured: false });

  // WR present, breach absent → surfaced but flagged so the render never shows a bare high WR.
  const wrOnly = condorWinRateLine({ est_win_rate: 98, est_intraday_breach_pct: null });
  assert.equal(wrOnly.winRate, 98);
  assert.equal(wrOnly.breachRatePct, null);
  assert.equal(wrOnly.breachUnmeasured, true);

  const none = condorWinRateLine({ est_win_rate: null, est_intraday_breach_pct: null });
  assert.equal(none.breachUnmeasured, false); // no WR to flag
});

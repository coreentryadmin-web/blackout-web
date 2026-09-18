import assert from "node:assert/strict";
import test from "node:test";
import { scoreMomentumRail } from "./momentum";

// ── E6 momentum_abs_floor false-reject fix (docs/audit/0DTE-RESEARCH.md) ──────────────────────
// thesis-rank-reject-outcome-ab.mjs measured, on 599 real setups through the REAL
// attachThesisFirstLive pipeline (10 real sessions, confirmed at both 10:00 and 10:30 ET entry):
// REJECT graded 64.3% WR (n=129) vs PASS 52.3% WR (n=470) — the gate blocks the BETTER
// population. 115/129 rejections fired on momentum_abs_floor (archetype-gates.ts, >=60), and the
// root cause traced here: scoreMomentumRail never received a real `change_pct`, and BREAKOUT-
// origin setups additionally never carry a real `rel_vol` (enrichSetup runs with a null dossier
// for that origin — breakout-source.ts). That left a BREAKOUT-origin setup's MOMENTUM rail
// structurally capped at 40 (base) + 12 (5m trend) + 10 (VWAP) = 62, with no third real lever —
// so any setup missing even one of the two intraday alignments could never clear the 60 floor,
// regardless of how strong its actual breakout day-move was.
//
// NOTE ON SCOPE: `scoreMomentumRail` itself always accepted a `change_pct` parameter — it was
// never buggy in isolation, which is why these are plain unit specs, not the regression proof.
// The real bug was one level up: `railHitsFromLegacySetup` (rails/legacy-bridge.ts) never READ
// `setup.change_pct` when calling this function, so the input stayed dead regardless of what a
// setup carried. That wiring-level regression (RED pre-fix / GREEN post-fix, proved by reverting
// only legacy-bridge.ts) lives in `legacy-bridge-momentum.test.ts` alongside this file.

test("scoreMomentumRail: change_pct adds real momentum points when the day-move is strong", () => {
  const withoutChange = scoreMomentumRail({
    ticker: "ASTS",
    direction: "long",
    rel_vol: null,
    intraday: { trend_5m: "up", vwap_dist_pct: null } as any,
  });
  const withChange = scoreMomentumRail({
    ticker: "ASTS",
    direction: "long",
    rel_vol: null,
    intraday: { trend_5m: "up", vwap_dist_pct: null } as any,
    change_pct: 8.2,
  });
  assert.ok(withoutChange != null && withChange != null);
  // base 40 + trend_5m 12 = 52 (registers a hit — clears scoreMomentumRail's own >=52 floor —
  // but 52 < archetype-gates.ts's momentum_abs_floor of 60).
  assert.equal(withoutChange!.score, 52);
  // + min(10, 8.2*3)=10 real change_pct points = 62, now clears the 60 floor.
  assert.equal(withChange!.score, 62);
});

test("scoreMomentumRail: with change_pct supplied, a real BREAKOUT day-move clears momentum_abs_floor" +
  " where an unpopulated change_pct would leave it stuck below the gate", () => {
  const FLOOR = 60; // archetype-gates.ts's momentum_abs_floor (non-relief value)
  const preFix = scoreMomentumRail({
    ticker: "ASTS",
    direction: "long",
    rel_vol: null, // always null for BREAKOUT-origin — no dossier fetched for this origin
    intraday: { trend_5m: "up", vwap_dist_pct: null } as any,
    // change_pct omitted — this is the pre-fix state: buildBreakoutSetup never populated it and
    // legacy-bridge.ts never read it, for any origin.
  });
  assert.ok(preFix != null);
  assert.ok(preFix!.score < FLOOR, "pre-fix: a real breakout with only one intraday alignment stayed under the gate floor");

  const postFix = scoreMomentumRail({
    ticker: "ASTS",
    direction: "long",
    rel_vol: null,
    intraday: { trend_5m: "up", vwap_dist_pct: null } as any,
    change_pct: 8.2, // now populated by buildBreakoutSetup from the mover's real day gain
  });
  assert.ok(postFix != null);
  assert.ok(postFix!.score >= FLOOR, "post-fix: the same real breakout now clears the gate floor on its own real day-move");
});

test("scoreMomentumRail: change_pct uses the magnitude regardless of sign (breakdown movers)", () => {
  // rel_vol (not direction-dependent) pushes both above the rail's own >=52 hit floor so both
  // sides register a hit and are directly comparable.
  const long = scoreMomentumRail({ ticker: "X", direction: "long", rel_vol: 2.0, intraday: null, change_pct: 6.4 });
  const short = scoreMomentumRail({ ticker: "X", direction: "short", rel_vol: 2.0, intraday: null, change_pct: -6.4 });
  assert.ok(long != null && short != null);
  assert.equal(long!.score, short!.score);
});

test("scoreMomentumRail: change_pct alone is capped at 10 points and does not fabricate a floor-clearing score", () => {
  // Base 40 + change_pct max 10 = 50, still below the rail's own 52 hit-registration floor — the
  // fix gives a real third input, it does not manufacture a pass on a day-move alone.
  const result = scoreMomentumRail({
    ticker: "X",
    direction: "long",
    rel_vol: null,
    intraday: null,
    change_pct: 50, // an extreme move — still capped at +10 by Math.min(10, ...)
  });
  assert.equal(result, null);
});

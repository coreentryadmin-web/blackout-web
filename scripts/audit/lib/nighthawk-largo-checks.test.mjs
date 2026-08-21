import { strict as assert } from "node:assert";
import test from "node:test";
import {
  condorDeniedExists,
  condorWinRateHasBreachCompanion,
  claimsMarketOpen,
  sessionClaimMatchesPhase,
  pnlSignFlips,
  statedRatesAreSelfConsistent,
} from "./nighthawk-largo-checks.mjs";

test("condorDeniedExists catches the #2519 confabulation and passes an honest answer", () => {
  assert.equal(condorDeniedExists("Night Hawk does not have a dedicated iron condor setup type.").pass, false);
  assert.equal(condorDeniedExists("The iron condor sells short strikes ±0.6-0.8% for a net credit.").pass, true);
});

test("condorWinRateHasBreachCompanion enforces the honest-skew rule", () => {
  // Win rate cited WITHOUT breach → fail (the flattering-half-only defect).
  assert.equal(condorWinRateHasBreachCompanion("The condor win rate is about 92%.").pass, false);
  // Win rate WITH breach companion → pass.
  assert.equal(
    condorWinRateHasBreachCompanion("The condor wins ~92% but breaches intraday ~18.7% of days (negative skew).").pass,
    true,
  );
  // No win rate at all → nothing to pair.
  assert.equal(condorWinRateHasBreachCompanion("No condor is live right now.").pass, true);
});

test("claimsMarketOpen / sessionClaimMatchesPhase catch the #2525 pre-market hallucination", () => {
  const answer = "The market opened at 9:30 AM ET and the scan cycle is still running.";
  assert.equal(claimsMarketOpen(answer), true);
  assert.equal(sessionClaimMatchesPhase(answer, "PRE_MARKET").pass, false);
  assert.equal(sessionClaimMatchesPhase(answer, "RTH").pass, true);
  // An honest pre-market answer.
  const honest = "It is pre-market; the board is empty and the scanner has not committed anything today.";
  assert.equal(sessionClaimMatchesPhase(honest, "PRE_MARKET").pass, true);
});

test("pnlSignFlips catches a closed WINNER reported as a loss (#2490)", () => {
  const rows = [{ ticker: "WRBY", realized_pnl_pct: 32.69 }, { ticker: "CPNG", realized_pnl_pct: -60 }];
  // WRBY realized +32.69% but the answer states it as a loss → flip.
  const bad = pnlSignFlips("WRBY was the only loser, -34.62%. CPNG stopped at -60%.", rows);
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /WRBY/);
  // Correct signs → pass.
  const good = pnlSignFlips("WRBY closed +32.69%; CPNG stopped at -60%.", rows);
  assert.equal(good.pass, true);
});

test("statedRatesAreSelfConsistent catches '3 of 16 (23.1%)' (#2480/#2523)", () => {
  assert.equal(statedRatesAreSelfConsistent("target_unreachable: 3 of 16 (23.1%) would have won.").pass, false);
  // 3 of 13 (23.1%) is consistent.
  assert.equal(statedRatesAreSelfConsistent("3 of 13 (23.1%) would have won.").pass, true);
  // A correct pairing.
  assert.equal(statedRatesAreSelfConsistent("2 of 4 (50%) resolved as wins.").pass, true);
});

test("graders return evidence, not just a boolean", () => {
  for (const r of [
    condorDeniedExists("does not have a dedicated iron condor"),
    condorWinRateHasBreachCompanion("condor win rate is 92%"),
    statedRatesAreSelfConsistent("3 of 16 (23.1%)"),
  ]) {
    assert.equal(typeof r.pass, "boolean");
    assert.ok(r.detail.length > 0, "every verdict carries its evidence");
  }
});

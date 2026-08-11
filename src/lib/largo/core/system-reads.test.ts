import test from "node:test";
import assert from "node:assert/strict";
import {
  helixFlowRead,
  vectorPlayRead,
  nightHawkRead,
  gammaRegimeRead,
  agreementOf,
  type SystemRead,
} from "./system-reads";

test("HELIX measures directional CONCENTRATION, not raw net", () => {
  // Same net, wildly different tapes: $2M net inside $4M gross is a one-sided tape; the same $2M
  // inside $200M of two-way churn is noise. A raw-net read cannot tell them apart.
  const onesided = helixFlowRead({ netPremium: 2e6, grossPremium: 4e6, printCount: 200 });
  const churn = helixFlowRead({ netPremium: 2e6, grossPremium: 200e6, printCount: 200 });

  assert.equal(onesided.stance, "bullish");
  assert.equal(onesided.strength, 50);
  assert.equal(churn.stance, "neutral"); // 1% concentration is balance, not a side
  assert.equal(churn.strength, 1);
});

test("HELIX: puts drive the bearish side and the basis is checkable", () => {
  const r = helixFlowRead({ netPremium: -30e6, grossPremium: 40e6, printCount: 150 });
  assert.equal(r.stance, "bearish");
  assert.equal(r.strength, 75);
  assert.match(r.basis, /net −\$30\.0M of \+\$40\.0M gross · 150 prints/);
});

test("a thin sample is NO READ, not neutral — and says why", () => {
  const r = helixFlowRead({ netPremium: 5e6, grossPremium: 5e6, printCount: 3 });
  assert.equal(r.stance, "no-read");
  assert.equal(r.strength, null); // never 0, never 50
  assert.equal(r.reason, "only 3 prints");
});

test("no tape at all is NO READ", () => {
  const r = helixFlowRead({ netPremium: null, grossPremium: null, printCount: 0 });
  assert.equal(r.stance, "no-read");
  assert.equal(r.reason, "no flow tape");
  // Zero gross would divide by zero; it must not become a 0-strength "neutral".
  assert.equal(helixFlowRead({ netPremium: 0, grossPremium: 0, printCount: 50 }).stance, "no-read");
});

test("VECTOR cites its own conviction and never invents one", () => {
  const withConviction = vectorPlayRead({ bias: "bullish", grade: "A", conviction: 76 });
  assert.equal(withConviction.stance, "bullish");
  assert.equal(withConviction.strength, 76);
  assert.equal(withConviction.basis, "A · bullish");

  // A grade is not a score. No conviction from Vector means no bar — not a grade mapped to a number.
  const gradeOnly = vectorPlayRead({ bias: "bearish", grade: "B", conviction: null });
  assert.equal(gradeOnly.stance, "bearish");
  assert.equal(gradeOnly.strength, null);

  assert.equal(vectorPlayRead(null).stance, "no-read");
  assert.equal(vectorPlayRead({ bias: "" }).reason, "no play derived");
});

test("NIGHT HAWK reports a count, never a sentiment bar", () => {
  const r = nightHawkRead([{ direction: "long" }, { direction: "call" }, { direction: "short" }]);
  assert.equal(r.stance, "bullish");
  // One open call is not "100% bullish"; mapping play count onto 0-100 would say exactly that.
  assert.equal(r.strength, null);
  assert.equal(r.basis, "3 plays · 2L/1S");

  assert.equal(nightHawkRead([]).stance, "no-read");
  assert.equal(nightHawkRead(null).reason, "lane unavailable");
  // An even split is a real finding, not an absence.
  assert.equal(nightHawkRead([{ direction: "call" }, { direction: "put" }]).stance, "neutral");
});

test("GAMMA is a regime row and can never become a directional vote", () => {
  const above = gammaRegimeRead({ spot: 7760, gammaFlip: 7700 });
  assert.equal(above.kind, "regime");
  assert.equal(above.stance, "neutral");
  assert.equal(above.strength, null);
  assert.match(above.basis, /^positive gamma · spot \+0\.78% vs flip$/);

  const below = gammaRegimeRead({ spot: 7700, gammaFlip: 7760 });
  assert.match(below.basis, /^negative gamma · spot −0\.77% vs flip$/);

  assert.equal(gammaRegimeRead({ spot: null, gammaFlip: 7760 }).stance, "no-read");
});

const bull: SystemRead = { system: "A", kind: "directional", stance: "bullish", strength: 60, basis: "" };
const bear: SystemRead = { system: "B", kind: "directional", stance: "bearish", strength: 60, basis: "" };
const flat: SystemRead = { system: "C", kind: "directional", stance: "neutral", strength: 5, basis: "" };
const absent: SystemRead = { system: "D", kind: "directional", stance: "no-read", strength: null, basis: "" };
const regime: SystemRead = { system: "GAMMA", kind: "regime", stance: "neutral", strength: null, basis: "" };

test("agreement: two systems on one side is aligned", () => {
  const a = agreementOf([bull, { ...bull, system: "B2" }, flat]);
  assert.equal(a.verdict, "aligned");
  assert.equal(a.direction, "bullish");
  assert.equal(a.voting, 3);
});

test("agreement: one opinion beside four absences is NOT consensus", () => {
  const a = agreementOf([bull, absent, { ...absent, system: "E" }]);
  assert.equal(a.verdict, "insufficient");
  assert.equal(a.direction, null);
  assert.equal(a.voting, 1);
});

test("agreement: any opposition breaks alignment, and split has no direction", () => {
  const a = agreementOf([bull, { ...bull, system: "B2" }, bear]);
  assert.equal(a.verdict, "split");
  assert.equal(a.direction, null); // never a coin flip toward the majority
  assert.equal(a.bullish, 2);
  assert.equal(a.bearish, 1);
});

test("agreement: regime and no-read rows never vote", () => {
  // Two bulls plus a regime row must not read as three-way agreement.
  const a = agreementOf([bull, { ...bull, system: "B2" }, regime, absent]);
  assert.equal(a.voting, 2);
  assert.equal(a.verdict, "aligned");
  // Regime alone cannot manufacture a tally.
  assert.equal(agreementOf([regime, regime]).verdict, "insufficient");
});

test("agreement: all-neutral is a sample, not a side", () => {
  const a = agreementOf([flat, { ...flat, system: "C2" }]);
  assert.equal(a.verdict, "split");
  assert.equal(a.direction, null);
  assert.equal(a.neutral, 2);
});

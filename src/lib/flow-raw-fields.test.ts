import test from "node:test";
import assert from "node:assert/strict";
import { extractChainFieldsFromRaw, askPctFromTwoSidedPremium } from "./flow-raw-fields";

// Mirror of board.ts aggressionWeight (a private fn there) — the 0-100 ask_pct -> conviction
// weight mapping the derived value must feed. Kept in lockstep with board.ts; the live
// scan.ts/board.ts pipeline exercises the real one (see the before/after aggression probe).
function aggressionWeight(askPct: number | null | undefined): number {
  if (askPct == null || !Number.isFinite(askPct)) return 0.5;
  if (askPct >= 60) return 1;
  if (askPct >= 45) return 0.6;
  return 0.15;
}

test("extractChainFieldsFromRaw: numeric strings from UW WS payloads", () => {
  const fields = extractChainFieldsFromRaw(
    {
      price: "4.25",
      ask_side_pct: "72",
      underlying_last: "590.24",
      open_interest: "12000",
      iv: "0.42",
      alert_rule: "RepeatedHitsSweep",
    },
    { strike: 600, option_type: "CALL" }
  );
  assert.equal(fields.fill_price, 4.25);
  assert.equal(fields.ask_pct, 72);
  assert.equal(fields.underlying_price, 590.24);
  assert.equal(fields.open_interest, 12000);
  assert.equal(fields.implied_volatility, 0.42);
  assert.equal(fields.alert_rule, "RepeatedHitsSweep");
  assert.ok(fields.otm_pct != null && fields.otm_pct > 0);
});

test("extractChainFieldsFromRaw: skips OTM for UNKNOWN side", () => {
  const fields = extractChainFieldsFromRaw(
    { underlying_price: 100, price: 1 },
    { strike: 105, option_type: "UNKNOWN" }
  );
  assert.equal(fields.otm_pct, undefined);
});

// ── ask_pct derivation from the two-sided premium UW actually sends (aggression plumbing) ──
// Root cause fixed here: UW does NOT send `ask_side_pct` on flow_alerts (live 0/2780 rows), so
// reading it alone left ask_pct null on every print and pinned board.ts aggressionWeight to the
// neutral 0.5 for every ticker. Derive it from total_ask_side_prem/total_bid_side_prem (100%
// coverage) as a 0-100 pct — the SAME scale as the direct field above (ask_side_pct "72" -> 72).

test("askPctFromTwoSidedPremium: ask-dominant -> 0-100 pct (ratio 0.70 -> 70, NOT the raw 0.70)", () => {
  const ratio = 700_000 / (700_000 + 300_000);
  assert.equal(ratio, 0.7); // the underlying ask-side share
  assert.equal(askPctFromTwoSidedPremium(700_000, 300_000), 70); // stored on the 0-100 ask_pct scale
});

test("askPctFromTwoSidedPremium: guards -> undefined (never 0); bid=0 with ask>0 is a valid full-ask 100", () => {
  assert.equal(askPctFromTwoSidedPremium(undefined, undefined), undefined); // both absent
  assert.equal(askPctFromTwoSidedPremium(700_000, undefined), undefined); // one side absent -> can't form denom
  assert.equal(askPctFromTwoSidedPremium(0, 0), undefined); // zero total -> null, NOT 0
  assert.equal(askPctFromTwoSidedPremium(0, 300_000), 0); // genuinely fully sold -> a real 0
  assert.equal(askPctFromTwoSidedPremium(500_000, 0), 100); // fully at ask -> 100
});

test("extractChainFieldsFromRaw: derives ask_pct from total_ask/bid when ask_side_pct is absent (UW reality)", () => {
  const fields = extractChainFieldsFromRaw(
    { total_ask_side_prem: 700_000, total_bid_side_prem: 300_000, price: 4.25 },
    { strike: 600, option_type: "CALL" }
  );
  assert.equal(fields.ask_pct, 70); // 70% at-ask on the 0-100 scale
  assert.equal(fields.fill_price, 4.25); // unrelated fields still extracted
  // And it lands on the SAME scale a direct ask_side_pct would: 720k/280k == the field value "72".
  const f72 = extractChainFieldsFromRaw(
    { total_ask_side_prem: 720_000, total_bid_side_prem: 280_000 },
    { strike: 600, option_type: "CALL" }
  );
  assert.equal(f72.ask_pct, 72);
});

test("extractChainFieldsFromRaw: a real ask_side_pct wins over the derived fallback", () => {
  const fields = extractChainFieldsFromRaw(
    // Direct field says 85 even though the premium split alone would derive 70 — direct wins.
    { ask_side_pct: "85", total_ask_side_prem: 700_000, total_bid_side_prem: 300_000 },
    { strike: 600, option_type: "CALL" }
  );
  assert.equal(fields.ask_pct, 85);
});

test("extractChainFieldsFromRaw: no ask_side_pct and no usable premium legs -> ask_pct undefined (not 0)", () => {
  const none = extractChainFieldsFromRaw({ price: 1 }, { strike: 105, option_type: "CALL" });
  assert.equal(none.ask_pct, undefined);
  const zero = extractChainFieldsFromRaw(
    { total_ask_side_prem: 0, total_bid_side_prem: 0 },
    { strike: 105, option_type: "CALL" }
  );
  assert.equal(zero.ask_pct, undefined); // zero-total -> null, never 0
});

test("derived ask_pct reactivates aggressionWeight — conviction (70 -> 1), sold (20 -> 0.15), null stays 0.5", () => {
  const aggressive = extractChainFieldsFromRaw(
    { total_ask_side_prem: 700_000, total_bid_side_prem: 300_000 },
    { strike: 600, option_type: "CALL" }
  );
  const sold = extractChainFieldsFromRaw(
    { total_ask_side_prem: 200_000, total_bid_side_prem: 800_000 },
    { strike: 600, option_type: "CALL" }
  );
  const unknown = extractChainFieldsFromRaw({ price: 1 }, { strike: 600, option_type: "CALL" });
  assert.equal(aggressionWeight(aggressive.ask_pct), 1); // 70 -> full conviction (was a flat 0.5)
  assert.equal(aggressionWeight(sold.ask_pct), 0.15); // 20 -> sold/opposite intent (was a flat 0.5)
  assert.equal(aggressionWeight(unknown.ask_pct), 0.5); // genuinely unknown still neutral
  // Regression guard against the 0-1 scale trap: had we stored the raw 0.70 ratio, EVERY print
  // (all ratios < 45) would collapse to a flat 0.15 — still dead, and semantically inverted.
  assert.notEqual(aggressive.ask_pct, 0.7);
});

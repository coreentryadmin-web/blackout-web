import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compareSidesFrom, type ComparePositioningInput } from "./helix-thermal-compare";

/**
 * The LIVE production `gamma_regime_read` for SPY, captured 2026-08-21T00:10Z from
 * GET /api/market/gex-positioning?ticker=SPY. Kept verbatim — including the trailing
 * levels list — because that trailing list is what broke the old classifier: it tested
 * /positive|long gamma|support|pin/ FIRST and returned "bullish" on a hit, so the word
 * "support" in "…support 765." matched a matrix the very same sentence describes as
 * "net short gamma at EVERY strike … moves accelerate".
 *
 * SPX and QQQ returned the same shape in the same capture; all three inverted, 3 of 3.
 */
const LIVE_SHORT_GAMMA_REGIME_READ =
  "No gamma flip — dealers are net short gamma at EVERY strike, so there is no long-gamma " +
  "region above spot 762.6 → short gamma: momentum / vol expansion, moves accelerate. " +
  "Resistance 780, support 765.";

const LIVE_SPY_POS: ComparePositioningInput = {
  gamma_posture: "short",
  gamma_regime_read: LIVE_SHORT_GAMMA_REGIME_READ,
  flip: null,
  call_wall: 780,
  put_wall: 765,
  spot: 762.6,
};

const NO_FLOW = { rows: [], available: false };
const BULLISH_FLOW = {
  rows: [
    { ticker: "SPY", premium: 900_000, option_type: "call" },
    { ticker: "SPY", premium: 100_000, option_type: "put" },
  ],
  available: true,
};

describe("compare card — gamma side is derived from posture, not prose", () => {
  it("does NOT report the live short-gamma matrix as bullish (the 3-of-3 inversion)", () => {
    const { gamma } = compareSidesFrom(LIVE_SPY_POS, NO_FLOW);

    // The exact regression: prose containing "support" must never drive the bias.
    assert.notEqual(gamma.bias, "bullish");
    assert.notEqual(gamma.bias, "bearish", "dealer gamma is not directional");
    assert.equal(gamma.bias, "mixed");
    assert.equal(gamma.volatility_regime, "amplifying");
    assert.equal(gamma.gamma_posture, "short");
    // The prose is still SERVED verbatim for display — we stopped PARSING it, not carrying it.
    assert.equal(gamma.gamma_regime, LIVE_SHORT_GAMMA_REGIME_READ);
  });

  it("classifies off posture even when the prose says the opposite words", () => {
    // Posture and prose deliberately disagree: posture is authoritative, prose is decoration.
    const { gamma } = compareSidesFrom(
      { ...LIVE_SPY_POS, gamma_posture: "long", gamma_regime_read: "short gamma, break, volatility" },
      NO_FLOW
    );
    assert.equal(gamma.bias, "neutral");
    assert.equal(gamma.volatility_regime, "suppressing");
  });

  it("reports unknown when posture is null, however chatty the prose", () => {
    const { gamma } = compareSidesFrom(
      { ...LIVE_SPY_POS, gamma_posture: null, gamma_regime_read: "support and pin and long gamma" },
      NO_FLOW
    );
    assert.equal(gamma.bias, "unknown");
    assert.equal(gamma.volatility_regime, null);
  });

  it("never emits a directional bias for ANY posture value", () => {
    for (const posture of ["long", "short", null] as const) {
      const { gamma } = compareSidesFrom({ ...LIVE_SPY_POS, gamma_posture: posture }, NO_FLOW);
      assert.ok(
        !["bullish", "bearish"].includes(gamma.bias),
        `posture ${String(posture)} produced directional bias ${gamma.bias}`
      );
    }
  });
});

describe("compare card — absence is never published as agreement", () => {
  it("two cold sides do not read as a clean 'no conflict'", () => {
    const r = compareSidesFrom(null, NO_FLOW);
    assert.equal(r.conflict, false);
    // The bug: conflict_note was null, indistinguishable from a genuine all-clear.
    assert.notEqual(r.conflict_note, null);
    assert.match(String(r.conflict_note), /not compared/i);
    assert.equal(r.flow.available, false);
    assert.equal(r.gamma.available, false);
  });

  it("a known flow side beside an unknown gamma side still says nothing was compared", () => {
    const r = compareSidesFrom(null, BULLISH_FLOW);
    assert.equal(r.flow.bias, "bullish");
    assert.equal(r.conflict, false);
    assert.match(String(r.conflict_note), /not compared/i);
    assert.match(String(r.conflict_note), /gamma/i);
  });

  it("a real gamma read beside real flow is still not a direction conflict", () => {
    // Gamma is non-directional by construction, so this can only ever be "not compared".
    const r = compareSidesFrom(LIVE_SPY_POS, BULLISH_FLOW);
    assert.equal(r.flow.bias, "bullish");
    assert.equal(r.gamma.bias, "mixed");
    assert.equal(r.conflict, false);
    assert.match(String(r.conflict_note), /not compared/i);
  });
});

describe("compare card — flow side arithmetic", () => {
  it("sums call and put premium off the tape rows", () => {
    const { flow } = compareSidesFrom(null, BULLISH_FLOW);
    assert.equal(flow.call_premium, 900_000);
    assert.equal(flow.put_premium, 100_000);
    assert.equal(flow.net_premium, 800_000);
    assert.equal(flow.print_count, 2);
  });

  it("ignores non-finite premiums rather than poisoning the sum", () => {
    const { flow } = compareSidesFrom(null, {
      rows: [
        { ticker: "SPY", premium: Number.NaN, option_type: "call" },
        { ticker: "SPY", premium: 500_000, option_type: "call" },
      ],
      available: true,
    });
    assert.equal(flow.call_premium, 500_000);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cardStamp,
  compareSidesFrom,
  regimeInteractionFor,
  type ComparePositioningInput,
} from "./helix-thermal-compare";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";

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

const MATRIX_ASOF = "2026-08-21T00:24:56.192Z";
const LIVE_SPY_POS: ComparePositioningInput = {
  gamma_posture: "short",
  asof: MATRIX_ASOF,
  gamma_regime_read: LIVE_SHORT_GAMMA_REGIME_READ,
  flip: null,
  call_wall: 780,
  put_wall: 765,
  spot: 762.6,
};

const NO_FLOW = { rows: [], available: false, windowHours: 48 };
const BULLISH_FLOW = {
  rows: [
    { ticker: "SPY", premium: 900_000, option_type: "call" },
    { ticker: "SPY", premium: 100_000, option_type: "put" },
  ],
  available: true,
  windowHours: 48,
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

describe("compare card — the stamp is an ET session anchor, not a UTC instant", () => {
  it("stamps ET wall-clock and session date, keeping the UTC instant alongside", () => {
    // 2026-08-21T00:29Z = 2026-08-20 20:29 ET — the exact instant measured live, and the window
    // where a UTC date is already a session ahead.
    const card = cardStamp(Date.parse("2026-08-21T00:29:00Z"));
    // A UTC ISO rolls its calendar DATE at 20:00 ET, so a session resolved from it is a full
    // session ahead for the last four hours of every trading day (#2418 / #2420 class).
    assert.doesNotMatch(String(card.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/, "as_of must not be a UTC ISO");
    assert.match(String(card.as_of), / ET$/);
    assert.match(String(card.session_date), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(String(card.as_of_utc), /^\d{4}-\d{2}-\d{2}T.*Z$/, "machine instant kept alongside");
    assert.equal(card.as_of, "2026-08-20 20:29 ET");
    assert.equal(card.session_date, "2026-08-20", "ET session, NOT the 2026-08-21 UTC date");
    assert.equal(card.as_of_utc, "2026-08-21T00:29:00.000Z");
    assert.equal(card.market_session, "CLOSED");
  });

  it("freezes ONE instant per payload so phase and stamps cannot straddle a boundary", () => {
    // Same input instant must always give the same anchor — no second clock read inside.
    const a = cardStamp(Date.parse("2026-08-20T19:59:59Z"));
    const b = cardStamp(Date.parse("2026-08-20T19:59:59Z"));
    assert.deepEqual(a, b);
  });

  it("the ET session date can differ from the UTC date — that is the whole point", () => {
    // 2026-08-21T00:29Z is 2026-08-20 20:29 ET. The UTC date is already the 21st.
    const utcDate = new Date("2026-08-21T00:29:00Z").toISOString().slice(0, 10);
    assert.equal(utcDate, "2026-08-21");
    assert.equal(etSessionDate(Date.parse("2026-08-21T00:29:00Z")), "2026-08-20");
  });
});

describe("compare card — regime_interaction replaces the removed conflict signal", () => {
  it("names bullish flow entering an amplifying regime as higher variance", () => {
    const r = compareSidesFrom(LIVE_SPY_POS, BULLISH_FLOW);
    const ri = regimeInteractionFor(r.flow.bias, r.gamma.volatility_regime ?? null);
    assert.equal(ri?.flow_bias, "bullish");
    assert.equal(ri?.volatility_regime, "amplifying");
    assert.match(String(ri?.read), /amplifying regime/i);
    assert.match(String(ri?.read), /either direction/i);
    // It must never restate the gamma side as a direction.
    assert.doesNotMatch(String(ri?.read), /gamma is (bullish|bearish)/i);
  });

  it("is null when either side has no reading", () => {
    assert.equal(regimeInteractionFor("unknown", "amplifying"), null);
    assert.equal(regimeInteractionFor("bullish", null), null);
  });

  it("describes a suppressing regime as damping follow-through", () => {
    const ri = regimeInteractionFor("bearish", "suppressing");
    assert.match(String(ri?.read), /suppressing regime/i);
    assert.match(String(ri?.read), /damped/i);
  });
});

describe("compare card — nothing measured is null, not zero", () => {
  it("does not report net premium as 0 when no priced print landed", () => {
    const { flow } = compareSidesFrom(LIVE_SPY_POS, NO_FLOW);
    // The bug: `callPrem - putPrem` ran unconditionally, so an empty tape served
    // `net_premium: 0` beside `bias: "unknown"` — a quotable "premium is flat" made of no data.
    assert.equal(flow.net_premium, null);
    assert.equal(flow.call_premium, null);
    assert.equal(flow.put_premium, null);
    assert.equal(flow.print_count, null);
    assert.equal(flow.bias, "unknown");
  });

  it("still reports a genuine zero net when calls and puts truly offset", () => {
    const { flow } = compareSidesFrom(LIVE_SPY_POS, {
      rows: [
        { ticker: "SPY", premium: 500_000, option_type: "call" },
        { ticker: "SPY", premium: 500_000, option_type: "put" },
      ],
      available: true,
      windowHours: 48,
    });
    // A measured zero is data and must survive — only the UNMEASURED zero is suppressed.
    assert.equal(flow.net_premium, 0);
    assert.equal(flow.bias, "neutral");
  });
});

describe("compare card — a reading names its window and its session", () => {
  it("names the flow lookback rather than implying today", () => {
    const { flow } = compareSidesFrom(LIVE_SPY_POS, BULLISH_FLOW);
    assert.equal(flow.window_hours, 48);
    assert.match(String(flow.summary), /48h/);
  });

  it("says which window was empty when there is no flow", () => {
    const { flow } = compareSidesFrom(LIVE_SPY_POS, NO_FLOW);
    assert.match(String(flow.summary), /48h/);
  });

  it("anchors the matrix time to its ET SESSION, not just a UTC instant", () => {
    const now = Date.parse("2026-08-21T00:29:56.192Z");
    const { gamma } = compareSidesFrom(LIVE_SPY_POS, NO_FLOW, now);
    assert.equal(gamma.matrix_asof, MATRIX_ASOF);
    // MATRIX_ASOF's UTC date is 2026-08-21; the ET session it belongs to is the 20th.
    assert.equal(gamma.matrix_session_date, "2026-08-20");
    assert.match(String(gamma.matrix_asof_et), / ET$/);
    assert.equal(gamma.age_seconds, 300);
    assert.equal(gamma.freshness, "cached");
  });

  it("reports nulls rather than a borrowed stamp when there is no matrix", () => {
    const { gamma } = compareSidesFrom(null, NO_FLOW);
    assert.equal(gamma.matrix_asof, null);
    assert.equal(gamma.matrix_asof_et, null);
    assert.equal(gamma.matrix_session_date, null);
    assert.equal(gamma.age_seconds, null);
    assert.equal(gamma.freshness, null);
  });
});

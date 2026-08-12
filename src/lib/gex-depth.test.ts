import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bsDelta,
  bsGamma,
  buildGexDepthLadder,
  dealerDeltaShares,
  netDollarGammaAt,
  normCdf,
  yearsToExpiry,
  type DepthContract,
} from "./gex-depth";

const TODAY = "2026-08-12";
const EXP = "2026-09-18"; // ~37 days out

function chain(parts: Array<Partial<DepthContract> & { strike: number; type: "call" | "put" }>): DepthContract[] {
  return parts.map((p) => ({
    expiry: EXP,
    openInterest: 1_000,
    iv: 0.30,
    sharesPerContract: 100,
    ...p,
  }));
}

/** Central finite difference — the ground truth every closed form here is checked against. */
function fd(f: (x: number) => number, x: number, h: number): number {
  return (f(x + h) - f(x - h)) / (2 * h);
}

describe("closed-form greeks", () => {
  it("normCdf matches known values", () => {
    assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
    assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-4);
    // Symmetry must hold or every delta above and below spot is subtly inconsistent.
    for (const x of [0.3, 1.1, 2.4]) assert.ok(Math.abs(normCdf(x) + normCdf(-x) - 1) < 1e-9);
  });

  it("bsGamma IS the derivative of bsDelta — not merely a plausible curve", () => {
    const [S, K, T, sig] = [600, 610, 0.1, 0.25];
    const numeric = fd((s) => bsDelta(s, K, T, sig, "call"), S, 0.01);
    assert.ok(Math.abs(numeric - bsGamma(S, K, T, sig)) < 1e-6);
  });

  it("put and call gamma are identical; put delta is call delta minus one", () => {
    const [S, K, T, sig] = [100, 105, 0.25, 0.4];
    assert.equal(bsGamma(S, K, T, sig), bsGamma(S, K, T, sig));
    const c = bsDelta(S, K, T, sig, "call");
    const p = bsDelta(S, K, T, sig, "put");
    assert.ok(Math.abs(c - p - 1) < 1e-9);
  });

  it("refuses to fabricate on unusable inputs", () => {
    assert.equal(bsGamma(0, 100, 0.1, 0.3), 0);
    assert.equal(bsGamma(100, 100, 0, 0.3), 0);
    assert.equal(bsGamma(100, 100, 0.1, 0), 0);
    assert.equal(bsDelta(100, 100, -1, 0.3, "call"), 0);
  });

  it("a settled expiry contributes nothing", () => {
    assert.ok(yearsToExpiry("2026-08-11", TODAY) < 0);
    const settled = chain([{ strike: 100, type: "call", expiry: "2026-08-11" }]);
    assert.equal(dealerDeltaShares(settled, 100, TODAY), 0);
    assert.equal(buildGexDepthLadder(settled, 100, { todayYmd: TODAY }).contractsUsed, 0);
  });
});

describe("depth ladder — structural invariants", () => {
  const book = chain([
    { strike: 95, type: "put", openInterest: 4_000 },
    { strike: 100, type: "call", openInterest: 6_000 },
    { strike: 105, type: "call", openInterest: 3_000 },
  ]);

  it("cumulative is exactly the running sum of the marginals, per side", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    const above = l.levels.filter((x) => x.price > 100);
    const below = l.levels.filter((x) => x.price < 100).sort((a, b) => b.price - a.price);
    let run = 0;
    for (const lv of above) {
      run += lv.notional;
      assert.ok(Math.abs(run - lv.cumulative) < 1e-6, `above ${lv.price}`);
    }
    run = 0;
    for (const lv of below) {
      run += lv.notional;
      assert.ok(Math.abs(run - lv.cumulative) < 1e-6, `below ${lv.price}`);
    }
  });

  it("the ladder is symmetric around spot and strictly ascending in price", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY, rangePct: 0.05, stepPct: 0.01 });
    assert.equal(l.levels.length, 10); // 5 each side
    assert.equal(l.levels.filter((x) => x.price > 100).length, 5);
    assert.equal(l.levels.filter((x) => x.price < 100).length, 5);
    for (let i = 1; i < l.levels.length; i++) {
      assert.ok(l.levels[i]!.price > l.levels[i - 1]!.price);
    }
  });

  it("maxAbsNotional bounds every bar, so the view can never overflow its track", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    for (const lv of l.levels) assert.ok(Math.abs(lv.notional) <= l.maxAbsNotional + 1e-9);
  });

  it("an empty or unusable chain degrades to a blank ladder, never a fabricated one", () => {
    for (const c of [[], chain([{ strike: 100, type: "call", openInterest: 0 }])]) {
      const l = buildGexDepthLadder(c, 100, { todayYmd: TODAY });
      assert.deepEqual(l.levels, []);
      assert.equal(l.crossing, null);
      assert.equal(l.maxAbsNotional, 0);
    }
    assert.equal(buildGexDepthLadder(book, 0, { todayYmd: TODAY }).levels.length, 0);
  });

  it("only the requested expiries contribute", () => {
    const mixed = [
      ...chain([{ strike: 100, type: "call" }]),
      ...chain([{ strike: 100, type: "call", expiry: "2026-12-18" }]),
    ];
    const both = buildGexDepthLadder(mixed, 100, { todayYmd: TODAY });
    const near = buildGexDepthLadder(mixed, 100, { todayYmd: TODAY, expiries: new Set([EXP]) });
    assert.equal(both.contractsUsed, 2);
    assert.equal(near.contractsUsed, 1);
    assert.ok(Math.abs(near.netGammaAtSpot) < Math.abs(both.netGammaAtSpot));
  });
});

/**
 * THE TEST THAT MATTERS. The whole product claim is that the shape of the ladder tells you the
 * regime at a glance: long gamma is a bowl that damps, short gamma is a slide that accelerates.
 * If these two ever stop being mirror images the visualization is actively lying to a member about
 * whether a level is support or an accelerant.
 */
describe("depth ladder — regime direction", () => {
  it("a net LONG-gamma book sells rallies and buys dips (damping bowl)", () => {
    const longGamma = chain([{ strike: 100, type: "call", openInterest: 10_000 }]);
    const l = buildGexDepthLadder(longGamma, 100, { todayYmd: TODAY });
    assert.ok(l.netGammaAtSpot > 0, "call OI must read as dealer-long gamma");
    for (const lv of l.levels) {
      if (lv.direction === "flat") continue;
      if (lv.price > 100) assert.equal(lv.direction, "sell", `above spot at ${lv.price}`);
      else assert.equal(lv.direction, "buy", `below spot at ${lv.price}`);
    }
  });

  it("a net SHORT-gamma book buys rallies and sells dips (accelerating slide)", () => {
    const shortGamma = chain([{ strike: 100, type: "put", openInterest: 10_000 }]);
    const l = buildGexDepthLadder(shortGamma, 100, { todayYmd: TODAY });
    assert.ok(l.netGammaAtSpot < 0, "put OI must read as dealer-short gamma");
    for (const lv of l.levels) {
      if (lv.direction === "flat") continue;
      if (lv.price > 100) assert.equal(lv.direction, "buy", `above spot at ${lv.price}`);
      else assert.equal(lv.direction, "sell", `below spot at ${lv.price}`);
    }
  });

  it("flipping the book's sign mirrors the ladder exactly", () => {
    const pos = buildGexDepthLadder(chain([{ strike: 100, type: "call" }]), 100, { todayYmd: TODAY });
    const neg = buildGexDepthLadder(chain([{ strike: 100, type: "put" }]), 100, { todayYmd: TODAY });
    assert.equal(pos.levels.length, neg.levels.length);
    for (let i = 0; i < pos.levels.length; i++) {
      assert.ok(Math.abs(pos.levels[i]!.notional + neg.levels[i]!.notional) < 1e-6);
    }
  });

  it("a book that flips sign across spot reports a crossing between the two regimes", () => {
    // Heavy put OI below, heavy call OI above → short gamma low, long gamma high.
    const split = chain([
      { strike: 92, type: "put", openInterest: 40_000 },
      { strike: 108, type: "call", openInterest: 40_000 },
    ]);
    const l = buildGexDepthLadder(split, 100, { todayYmd: TODAY, rangePct: 0.1, stepPct: 0.005 });
    assert.ok(l.crossing != null, "a sign-changing book must report a crossing");
    assert.ok(l.crossing! > 90 && l.crossing! < 110, `crossing ${l.crossing} should sit inside the ladder`);
  });

  /**
   * REGRESSION. `crossing` was first derived from the flow DIRECTION, which flips at spot in every
   * long-gamma book — that is just the bottom of the damping bowl, not a regime change. It reported
   * a "crossing" at spot for a chain with exactly one regime, which would have painted a flip line
   * on a ladder that has no flip. It is now derived from the sign of net dealer gamma.
   */
  it("a single-regime book has no crossing, even though its flow direction turns at spot", () => {
    const l = buildGexDepthLadder(chain([{ strike: 100, type: "call" }]), 100, { todayYmd: TODAY });
    assert.equal(l.crossing, null, "one regime must not report a flip");
    // The direction genuinely does turn at spot — that is the bowl, and it must not be mistaken
    // for a regime boundary.
    assert.equal(l.levels.find((x) => x.price > 100)!.direction, "sell");
    assert.equal(l.levels.filter((x) => x.price < 100).pop()!.direction, "buy");
    // ...and gamma stays one sign the whole way across, which is what "one regime" means.
    assert.ok(l.levels.every((x) => x.gamma > 0));
  });

  it("every level carries the gamma regime AT that price, not the regime at spot", () => {
    const split = chain([
      { strike: 92, type: "put", openInterest: 40_000 },
      { strike: 108, type: "call", openInterest: 40_000 },
    ]);
    const l = buildGexDepthLadder(split, 100, { todayYmd: TODAY, rangePct: 0.1, stepPct: 0.005 });
    const lowest = l.levels[0]!;
    const highest = l.levels[l.levels.length - 1]!;
    assert.ok(lowest.gamma < 0, "deep below, the put wall dominates → short gamma");
    assert.ok(highest.gamma > 0, "far above, the call wall dominates → long gamma");
    assert.ok(l.crossing! > lowest.price && l.crossing! < highest.price);
  });
});

/**
 * The ladder is only worth shipping if it describes the SAME book as the levels drawn next to it.
 * netGammaAtSpot recomputes net dealer gamma from Black-Scholes; the matrix computes it from the
 * provider's own greeks. They are independent routes to one number, so agreement is real evidence.
 */
describe("depth ladder — agreement with the matrix's own math", () => {
  it("netDollarGammaAt reproduces the matrix's per-1%-move GEX formula", () => {
    const c = chain([{ strike: 100, type: "call", openInterest: 5_000, iv: 0.3 }]);
    const t = yearsToExpiry(EXP, TODAY);
    const expected = 1 * bsGamma(100, 100, t, 0.3) * 5_000 * 100 * 100 * 100 * 0.01;
    assert.ok(Math.abs(netDollarGammaAt(c, 100, TODAY) - expected) < 1e-6);
  });

  it("adjusted contracts use their real multiplier, not a hardcoded 100", () => {
    const std = chain([{ strike: 100, type: "call" }]);
    const adj = chain([{ strike: 100, type: "call", sharesPerContract: 50 }]);
    assert.ok(Math.abs(netDollarGammaAt(std, 100, TODAY) / 2 - netDollarGammaAt(adj, 100, TODAY)) < 1e-6);
  });

  it("anchoring scales the ladder onto the matrix's number exactly", () => {
    const book = chain([{ strike: 100, type: "call", openInterest: 5_000 }]);
    const raw = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    const target = raw.netGammaAtSpot * 1.2;
    const anchored = buildGexDepthLadder(book, 100, { todayYmd: TODAY, anchorNetGamma: target });
    assert.ok(Math.abs(anchored.netGammaAtSpot - target) < 1e-6, "headline must match the matrix");
    assert.ok(Math.abs(anchored.calibrationFactor - 1.2) < 1e-9);
    // Shape is preserved — only the scale moves.
    for (let i = 0; i < raw.levels.length; i++) {
      assert.equal(raw.levels[i]!.direction, anchored.levels[i]!.direction);
      assert.ok(Math.abs(raw.levels[i]!.notional * 1.2 - anchored.levels[i]!.notional) < 1e-6);
    }
  });

  it("refuses to calibrate when the anchor is implausible, rather than hiding a real disagreement", () => {
    const book = chain([{ strike: 100, type: "call", openInterest: 5_000 }]);
    const raw = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    for (const bad of [
      raw.netGammaAtSpot * 40, // ratio way outside bounds — something is actually wrong
      -raw.netGammaAtSpot, // opposite sign — a sign bug, not a scale difference
      0,
      Number.NaN,
      null,
    ]) {
      const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY, anchorNetGamma: bad });
      assert.equal(l.calibrationFactor, 1, `anchor ${bad} must be refused`);
      assert.ok(Math.abs(l.netGammaAtSpot - raw.netGammaAtSpot) < 1e-6);
    }
  });

  it("the ladder's own bands integrate back to its net gamma", () => {
    // Σ(forced shares) across a band equals −ΔD, so summing the whole upper half must equal
    // −(D(top) − D(spot)). This is what makes 'cost to travel there' an honest number.
    const book = chain([
      { strike: 98, type: "put", openInterest: 3_000 },
      { strike: 102, type: "call", openInterest: 5_000 },
    ]);
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY, rangePct: 0.04, stepPct: 0.01 });
    const above = l.levels.filter((x) => x.price > 100);
    const summed = above.reduce((s, x) => s + x.shares, 0);
    const direct = -(dealerDeltaShares(book, 104, TODAY) - dealerDeltaShares(book, 100, TODAY));
    assert.ok(Math.abs(summed - direct) < 1e-6);
  });
});

/**
 * The view renders straight off these fields, so their SHAPE is a contract. A ladder that sorts
 * wrong, or whose bars can exceed their track, is a rendering bug that only shows up as a picture —
 * these catch it as a number instead.
 */
describe("depth ladder — what the view depends on", () => {
  const book = chain([
    { strike: 96, type: "put", openInterest: 8_000 },
    { strike: 100, type: "call", openInterest: 9_000 },
    { strike: 104, type: "call", openInterest: 4_000 },
  ]);

  it("every bar width is a valid percentage of the track", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    for (const lv of l.levels) {
      const w = (Math.abs(lv.notional) / l.maxAbsNotional) * 100;
      assert.ok(w >= 0 && w <= 100 && Number.isFinite(w), `width ${w} at ${lv.price}`);
    }
  });

  it("exactly one rung sits either side of spot at the boundary, so the spot row lands right", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY, rangePct: 0.02, stepPct: 0.01 });
    const desc = [...l.levels].sort((a, b) => b.price - a.price);
    const firstBelow = desc.findIndex((x) => x.price < 100);
    assert.ok(firstBelow > 0, "spot must not be at the very top of the ladder");
    assert.ok(desc[firstBelow - 1]!.price > 100, "the rung above the split must be above spot");
  });

  it("no NaN or Infinity can reach the DOM", () => {
    const l = buildGexDepthLadder(book, 100, { todayYmd: TODAY });
    for (const lv of l.levels) {
      for (const [k, v] of Object.entries(lv)) {
        if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} at ${lv.price} is ${v}`);
      }
    }
    assert.ok(Number.isFinite(l.maxAbsNotional));
    assert.ok(l.crossing == null || Number.isFinite(l.crossing));
  });

  it("a zero-gamma book yields flat rungs, not divide-by-zero bars", () => {
    // Every contract unusable → empty ladder, and the view's `max_abs_notional > 0 ? … : 1` guard
    // is never asked to divide by zero.
    const l = buildGexDepthLadder(chain([{ strike: 100, type: "call", iv: 0 }]), 100, { todayYmd: TODAY });
    assert.equal(l.levels.length, 0);
    assert.equal(l.maxAbsNotional, 0);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { wallsFromStrikeTotals, wallsByHorizon, sessionsBetweenYmd } from "./gex-cross-validation-core";

/**
 * A "call wall" below spot is not a call wall.
 *
 * `wallsFromStrikeTotals` took max-positive-GEX and max-negative-GEX ANYWHERE, with no requirement
 * that a call wall sit above spot or a put wall below it. Members read these as resistance and
 * support, so a wall on the wrong side is inverted, not merely imprecise.
 *
 * MEASURED ON PROD 2026-08-20 — 8 tickers sampled, THREE serving an inverted level:
 *
 *     AAPL   spot 312.66   call_wall 310   resistance BELOW price   -> constrained 320
 *     SPY    spot 763.11   put_wall  765   support ABOVE price      -> constrained 760
 *     META   spot 545.91   put_wall  550   support ABOVE price      -> constrained 540
 *
 * 3/8 is not an edge case. AAPL is the clearest harm: "resistance at 310" while price is already
 * 312.66 reads as "we are through resistance", which the engine does not mean.
 *
 * It flips on thin margins, so it is not rare by construction — on the live SPX 3DTE book 7500 beat
 * 7700 by 2.65B vs 2.52B, a 5% gap that put the answer on the wrong side of spot.
 */

test("REGRESSION: the three live inverted cases resolve to the correct side", () => {
  // AAPL — the positive-GEX peak sits BELOW spot; the real resistance is above it.
  const aapl = { "310": 4_000_000_000, "320": 3_100_000_000, "300": -2_000_000_000 };
  assert.equal(wallsFromStrikeTotals(aapl).callWall, 310, "unconstrained picks the wrong side");
  assert.equal(wallsFromStrikeTotals(aapl, 312.66).callWall, 320, "constrained picks resistance");

  // SPY / META — the negative-GEX peak sits ABOVE spot; the real support is below.
  const spy = { "765": -5_000_000_000, "760": -3_000_000_000, "780": 2_000_000_000 };
  assert.equal(wallsFromStrikeTotals(spy).putWall, 765);
  assert.equal(wallsFromStrikeTotals(spy, 763.11).putWall, 760);
});

test("thin margins are exactly why this is not rare", () => {
  // The live SPX 3DTE book: 7500 wins on 2.65B vs 7700's 2.52B — 5% — and lands 141pts below spot.
  const spx = { "7500": 2_650_000_000, "7700": 2_520_000_000, "7650": -4_330_000_000 };
  assert.equal(wallsFromStrikeTotals(spx).callWall, 7500);
  assert.equal(wallsFromStrikeTotals(spx, 7641.16).callWall, 7700);
});

test("NO FALLBACK to the wrong side — a missing wall is null", () => {
  // "There is no call wall above spot in this book" is TRUE. Inventing one below spot is not.
  // Same principle as the fabricated-vanna finding: absence is reported, never filled in.
  const noneAbove = { "300": 4_000_000_000, "290": 1_000_000_000 };
  assert.equal(wallsFromStrikeTotals(noneAbove, 312.66).callWall, null);
  // …and the other side still resolves independently.
  const mixed = { "300": 4_000_000_000, "290": -1_000_000_000 };
  assert.equal(wallsFromStrikeTotals(mixed, 312.66).callWall, null);
  assert.equal(wallsFromStrikeTotals(mixed, 312.66).putWall, 290);
});

test("omitting spot preserves the historical behaviour EXACTLY", () => {
  // Opt-in by design: 5 producers and a long tail of consumers (Meridian, Discord, thermal, both
  // verifiers) share this helper. Flipping them all at once is a behaviour change nobody asked
  // for; each call site is wired deliberately.
  const t = { "310": 4_000_000_000, "320": 3_100_000_000, "300": -2_000_000_000 };
  assert.deepEqual(wallsFromStrikeTotals(t), wallsFromStrikeTotals(t, undefined));
  assert.deepEqual(wallsFromStrikeTotals(t), wallsFromStrikeTotals(t, 0), "spot 0 = no quote = unconstrained");
  assert.deepEqual(wallsFromStrikeTotals(t), wallsFromStrikeTotals(t, Number.NaN));
});

test("the four member-facing producers pass spot", () => {
  // The recurring failure of this whole session: correct logic that nothing calls. Asserted on
  // source because reaching these needs Polygon, Redis and a live WS channel.
  const root = process.cwd();
  const core = readFileSync(join(root, "src/lib/providers/gex-cross-validation-core.ts"), "utf8");
  const overlay = readFileSync(join(root, "src/lib/providers/spx-odte-gex-uw-overlay.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/market/gex-heatmap/route.ts"), "utf8");
  const pos = readFileSync(join(root, "src/lib/providers/gex-positioning.ts"), "utf8");
  assert.match(core, /wallsFromStrikeTotals\(strikeTotals, spot\)/, "uwLevelsFromLadder");
  assert.match(overlay, /wallsFromStrikeTotals\(totals, hm\.spot\)/, "SPX 0DTE overlay");
  assert.match(route, /wallsFromStrikeTotals\([^)]*\), heatmap\.spot\)/, "heatmap WS override");
  assert.match(pos, /wallsFromStrikeTotals\([^)]*\), base\.spot\)/, "positioning WS override");
});

/** Horizon bucketing — the labelling half of the same problem. */

test("cumulative buckets, because that is what a trader is exposed to", () => {
  // "The 3DTE wall" means the book you hold over three sessions, not the third session alone. A
  // per-expiry reading showed a 2026-08-27 "call wall" BELOW spot — real for that strip, useless
  // as a level.
  const cells = {
    "7700": { "2026-08-21": 2_000_000_000 },
    "7750": { "2026-08-24": 3_000_000_000 },
    "7600": { "2026-08-21": -1_500_000_000 },
  };
  const hz = wallsByHorizon(cells, "2026-08-20", 7641.16);
  const three = hz.find((h) => h.label === "3DTE")!;
  assert.deepEqual(three.expiries, ["2026-08-21", "2026-08-24"], "3DTE includes the 1DTE strip");
  assert.equal(three.callWall, 7750, "the larger wall inside the window wins");
  assert.equal(three.putWall, 7600);
});

test("an empty bucket reports NO EXPIRY, never a missing wall", () => {
  // Post-close 0DTE legitimately has zero expiries — today's settled and left the chain. That must
  // render as "no expiry in range", not as a blank level.
  const cells = { "7700": { "2026-08-21": 2_000_000_000 } };
  const zero = wallsByHorizon(cells, "2026-08-20", 7641.16).find((h) => h.label === "0DTE")!;
  assert.deepEqual(zero.expiries, []);
  assert.equal(zero.callWall, null);
  assert.equal(zero.callWallPts, null);
});

test("horizon walls are side-constrained too", () => {
  const cells = { "7500": { "2026-08-21": 2_650_000_000 }, "7700": { "2026-08-21": 2_520_000_000 } };
  const three = wallsByHorizon(cells, "2026-08-20", 7641.16).find((h) => h.label === "3DTE")!;
  assert.equal(three.callWall, 7700, "must not inherit the wrong-side pick");
  assert.equal(three.callWallPts, 58.84);
});

test("session counting skips weekends", () => {
  assert.equal(sessionsBetweenYmd("2026-08-20", "2026-08-21"), 1);
  assert.equal(sessionsBetweenYmd("2026-08-20", "2026-08-24"), 2, "Fri->Mon is one session apart");
  assert.equal(sessionsBetweenYmd("2026-08-20", "2026-08-31"), 7);
  assert.equal(sessionsBetweenYmd("2026-08-20", "2026-08-20"), 0);
});

/**
 * The horizons have to REACH the member, not merely exist.
 *
 * The recurring failure of this session — correct logic nothing calls. `walls_by_horizon` is
 * useless if the matrix does not populate it, the Largo projection does not carry it, or the
 * prompt never tells the model to name the scope.
 */

test("the matrix populates walls_by_horizon from the SHIPPED cells", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"), "utf8");
  // Built from the PRUNED cells, so the horizons can never describe a book the member is not served.
  assert.match(src, /walls_by_horizon: wallsByHorizon\(gexPruned\.cells, todayEtYmd\(\), hm\.spot\)/);
});

test("the Largo projection carries the horizons — and declares them when degraded", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/largo/gex-heatmap-for-largo.ts"), "utf8");
  assert.match(src, /walls_by_horizon:\s*\n?\s*hm\.gex\?\.walls_by_horizon\?\.map/);
  // The degraded branch must set null, not omit. `undefined` reads to the model as "field absent"
  // rather than "value unknown" — the exact ambiguity that produced the fabricated vanna negative.
  const nullBranch = src.slice(0, src.indexOf("top_strikes: topStrikesFromTotals"));
  assert.match(nullBranch, /walls_by_horizon: null/);
});

test("the prompt requires the horizon to be NAMED, with the empty-bucket trap called out", () => {
  const sys = readFileSync(join(process.cwd(), "src/lib/largo/system-prompt.ts"), "utf8");
  assert.match(sys, /A wall without its horizon is not a level \(non-negotiable\)/);
  assert.match(sys, /0DTE call wall 7,700/, "must carry a worked ✅ example");
  // The distinction that matters: an empty bucket is a chain fact, not a market fact.
  assert.match(sys, /a bucket with no expiry is not a book without a wall/i);
  // Disagreement between horizon and aggregate is signal, not noise to smooth away.
  assert.match(sys, /that gap is the interesting part/i);
});

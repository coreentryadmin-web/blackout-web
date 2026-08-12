import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gammaShareByExpiry,
  levelsForExpiry,
  strikeTotalsForExpiry,
  type GexCells,
} from "./per-expiry-levels";

// Two expiries with DELIBERATELY opposite structure near spot 100: A is call-heavy above and
// put-heavy below; B is much larger and inverted. Blending them gives a different answer to either
// one alone — which is the whole point of scoping the panel.
const CELLS: GexCells = {
  "95": { "2026-08-12": -100, "2026-08-14": -50 },
  "98": { "2026-08-12": -400, "2026-08-14": -20 },
  "100": { "2026-08-12": 200, "2026-08-14": -900 },
  "102": { "2026-08-12": 500, "2026-08-14": 30 },
  "105": { "2026-08-12": 50, "2026-08-14": 2000 },
};

test("strikeTotalsForExpiry: collapses to one expiry and OMITS strikes it does not trade", () => {
  const a = strikeTotalsForExpiry(CELLS, "2026-08-12");
  assert.deepEqual(a, { "95": -100, "98": -400, "100": 200, "102": 500, "105": 50 });

  // A strike present in the matrix but absent from THIS expiry must not appear as 0 — "no
  // contracts here" is not "a balanced book here", and zero-filling would corrupt king/wall picks.
  const sparse: GexCells = { "100": { X: 5 }, "110": { Y: 7 } };
  assert.deepEqual(strikeTotalsForExpiry(sparse, "X"), { "100": 5 });
});

test("levelsForExpiry: walls, king and net GEX are per-expiry, and the blend differs from both", () => {
  const a = levelsForExpiry(CELLS, "2026-08-12", 100);
  const b = levelsForExpiry(CELLS, "2026-08-14", 100);

  assert.equal(a.callWall, 102, "expiry A's largest positive gamma");
  assert.equal(a.putWall, 98, "expiry A's largest negative gamma");
  assert.equal(a.netGex, -100 - 400 + 200 + 500 + 50);
  assert.equal(a.kingNode, 102, "largest |gamma| in A");

  assert.equal(b.callWall, 105, "expiry B is dominated by a far call strike");
  assert.equal(b.putWall, 100, "…and a big put node AT spot");
  assert.equal(b.kingNode, 105);

  // The two expiries disagree about every level. An aggregate panel shows one answer for both.
  assert.notEqual(a.callWall, b.callWall);
  assert.notEqual(a.putWall, b.putWall);
});

test("levelsForExpiry: an empty expiry column yields nulls, never fabricated levels", () => {
  const l = levelsForExpiry(CELLS, "2026-12-31", 100);
  assert.equal(l.strikes, 0);
  assert.equal(l.callWall, null);
  assert.equal(l.putWall, null);
  assert.equal(l.flip, null);
  assert.equal(l.kingNode, null);
  assert.equal(l.netGex, 0);
});

test("levelsForExpiry: no spot means no flip — a flip without a spot is meaningless", () => {
  assert.equal(levelsForExpiry(CELLS, "2026-08-12", 0).flip, null);
  // The rest of the levels do NOT depend on spot and must still be reported.
  assert.equal(levelsForExpiry(CELLS, "2026-08-12", 0).callWall, 102);
});

test("gammaShareByExpiry: shares sum to 1 and are banded around spot", () => {
  const shares = gammaShareByExpiry(CELLS, 100, 0.03);
  const total = shares.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "shares are a distribution");

  // ±3% of 100 keeps 98/100/102 and DROPS 95 and 105. That exclusion is load-bearing: 105 holds
  // B's 2000, which would otherwise swamp the contest with gamma too far away to pin the tape.
  const b = shares.find((s) => s.expiry === "2026-08-14")!;
  assert.equal(b.absGamma, 20 + 900 + 30, "far strikes excluded from the near-spot band");
});

test("gammaShareByExpiry: the band changes the winner — which is why it is banded", () => {
  const near = gammaShareByExpiry(CELLS, 100, 0.03);
  const wide = gammaShareByExpiry(CELLS, 100, 0.10);
  const winner = (rows: ReturnType<typeof gammaShareByExpiry>) =>
    [...rows].sort((x, y) => y.share - x.share)[0]!.expiry;

  // Near spot (97-103): A = 400+200+500 = 1100 beats B = 20+900+30 = 950.
  // Wide (90-110):       B = 50+20+900+30+2000 = 3000 beats A = 1250, on the far 105 node alone.
  //
  // The winner FLIPS with the band, and that is the entire argument for banding: a fat strike 5%
  // away decides the "who owns the gamma" question while being far too distant to pin the tape.
  // An unbanded share would hand the contest to whichever expiry owns the biggest far-dated node.
  assert.equal(winner(near), "2026-08-12", "near spot, A's cluster at 98/100/102 dominates");
  assert.equal(winner(wide), "2026-08-14", "wide, B's 2000 at 105 takes over");
});

test("gammaShareByExpiry: degrades safely on no spot, no cells, zero band", () => {
  assert.deepEqual(gammaShareByExpiry(CELLS, 0), []);
  assert.deepEqual(gammaShareByExpiry({}, 100), []);
  assert.deepEqual(gammaShareByExpiry(CELLS, 100, 0), []);
});

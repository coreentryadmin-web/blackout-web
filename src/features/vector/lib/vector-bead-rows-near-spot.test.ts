import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pickActiveStrikes,
  MAX_STRIKE_TRAILS_PER_SIDE,
  NEAR_SPOT_ROW_BAND_PCT,
  type StrikeTrailPoint,
} from "./vector-wall-history.ts";

/**
 * Bead ROW selection must prefer strikes near spot.
 *
 * The fixtures below are the REAL prod rails from 2026-08-07 (SPX spot 7757.64, META spot 592.2),
 * reduced to the strike + peak-strength pairs that drive `strikeTrailWeight`. They are what make
 * this a regression test rather than a tautology: SPX is the instrument where strength and
 * proximity DISAGREE (far-OTM crash-protection puts outrank near-spot walls), META is the one
 * where they agree — which is why the bug was invisible on single stocks.
 */

const pts = (...pcts: number[]): StrikeTrailPoint[] =>
  pcts.map((pct, i) => ({ time: 1786109400 + i * 5, pct }));

/** SPX put side as recorded on 2026-08-07 — the strongest rows sit 250-350pts below spot. */
function spxPutTrails(): Map<number, StrikeTrailPoint[]> {
  return new Map<number, StrikeTrailPoint[]>([
    [8000, pts(5.29, 0.96)],
    [7500, pts(2.84, 2.6)],
    [7600, pts(1.9, 1.7)],
    [7715, pts(2.69, 0.4)],
    [7730, pts(1.2, 1.1)],
    [7705, pts(1.68, 0.3)],
    [7450, pts(1.59, 1.4)],
    [7400, pts(1.53, 1.3)],
    [7750, pts(0.9, 0.85)],
    [7740, pts(0.8, 0.78)],
  ]);
}

const SPX_SPOT = 7757.64;
const META_SPOT = 592.2;
const nearCount = (strikes: number[], spot: number) =>
  strikes.filter((k) => Math.abs(k - spot) / spot <= 0.01).length;

test("without spot, ordering is exactly the old pure-strength ranking", () => {
  // The caller cannot always resolve spot; that path must not change behaviour at all.
  const trails = spxPutTrails();
  const got = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE);
  assert.deepEqual(got.slice(0, 3), [8000, 7500, 7715], "strongest-first, regardless of distance");
  assert.equal(got.length, MAX_STRIKE_TRAILS_PER_SIDE);
});

test("null / 0 / NaN spot all fall back to pure strength rather than throwing or emptying", () => {
  const trails = spxPutTrails();
  const baseline = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE);
  for (const bad of [null, undefined, 0, -1, NaN]) {
    assert.deepEqual(
      pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE, { spot: bad as number | null }),
      baseline,
      `spot=${String(bad)} must be treated as "unknown", not as a real price`
    );
  }
});

test("SPX: near-spot put rows win slots off the far-OTM crash strikes", () => {
  const trails = spxPutTrails();
  const before = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE);
  const after = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE, { spot: SPX_SPOT });

  // This is the whole point of the change: more of the 8 rows land where price actually is.
  assert.ok(
    nearCount(after, SPX_SPOT) > nearCount(before, SPX_SPOT),
    `expected more near-spot rows after (before=${nearCount(before, SPX_SPOT)}, after=${nearCount(after, SPX_SPOT)})`
  );
  // 7750/7740 were ranked out entirely before despite sitting right on price.
  assert.ok(!before.includes(7740), "fixture check: 7740 was crowded out by strength-only ordering");
  assert.ok(after.includes(7750) && after.includes(7740), "near-spot walls must now get rows");
});

test("SPX: a genuine far-OTM wall is NOT dropped — it is backfilled when slots remain", () => {
  // Partition, not filter. Silently hiding the 8000 put wall would trade one bug for another.
  const after = pickActiveStrikes(spxPutTrails(), MAX_STRIKE_TRAILS_PER_SIDE, { spot: SPX_SPOT });
  assert.ok(after.includes(8000), "the strongest far-OTM wall still renders when there is room");
});

test("far rows are only displaced when a nearer wall actually wants the slot", () => {
  // With enough slots for everything, the row SET is unchanged — only the order differs.
  const trails = spxPutTrails();
  const all = pickActiveStrikes(trails, trails.size, { spot: SPX_SPOT });
  assert.equal(all.length, trails.size);
  assert.deepEqual(
    [...all].sort((a, b) => a - b),
    [...trails.keys()].sort((a, b) => a - b),
    "no strike disappears when the cap is not binding"
  );
});

test("near rows stay strength-ordered among themselves", () => {
  const trails = new Map<number, StrikeTrailPoint[]>([
    [7750, pts(1.0)],
    [7760, pts(3.0)],
    [7740, pts(2.0)],
  ]);
  assert.deepEqual(
    pickActiveStrikes(trails, 3, { spot: SPX_SPOT }),
    [7760, 7740, 7750],
    "promotion must not scramble relative strength inside the near band"
  );
});

test("META: no row is lost when the cap is not binding, though on-price rows do get promoted", () => {
  // Real META put rail, 2026-08-07. Worth stating plainly: META's PUT side is spread out much like
  // SPX's (550/560/500 are 5-16% below spot) — it is META's CALL side that clusters on price. So
  // this is NOT a "single stocks are unaffected" test. What must hold is the safety property: with
  // only 5 rows competing for 8 slots the SET is untouched; the 590 wall sitting on top of price
  // merely moves ahead of the far 550, which is the intended behaviour, not a regression.
  const trails = new Map<number, StrikeTrailPoint[]>([
    [590, pts(3.62, 5.09)],
    [550, pts(6.93, 5.09)],
    [580, pts(4.14, 1.2)],
    [560, pts(2.6, 1.7)],
    [500, pts(2.31, 1.73)],
  ]);
  const before = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE);
  const after = pickActiveStrikes(trails, MAX_STRIKE_TRAILS_PER_SIDE, { spot: META_SPOT });
  assert.deepEqual(
    [...after].sort((a, b) => a - b),
    [...before].sort((a, b) => a - b),
    "under-cap: every strike that rendered before must still render"
  );
  assert.equal(after[0], 590, "the wall sitting on price leads once spot is known");
  assert.equal(before[0], 550, "fixture check: strength-only ordering led with the far 550 wall");
});

test("the band is a fraction of spot, so it scales across instruments", () => {
  // A band in absolute points would be meaningless across a 7757 index and a 592 stock.
  assert.ok(NEAR_SPOT_ROW_BAND_PCT > 0 && NEAR_SPOT_ROW_BAND_PCT < 0.1);
  const trails = new Map<number, StrikeTrailPoint[]>([
    [7757, pts(1)],
    [7900, pts(9)], // 1.84% away -> inside the default 2% band
    [8200, pts(9)], // 5.7% away  -> outside
  ]);
  const got = pickActiveStrikes(trails, 2, { spot: SPX_SPOT });
  assert.deepEqual(got, [7900, 7757], "in-band strikes promote ahead of out-of-band ones");
  // Same data, tighter band -> 7900 is now far, so the on-price row leads.
  assert.deepEqual(pickActiveStrikes(trails, 2, { spot: SPX_SPOT, bandPct: 0.005 }), [7757, 7900]);
});

test("the chart passes real spot into the picker at every bead call site", () => {
  // The library fix is inert unless VectorChart actually threads spot through; the live and replay
  // paths are separate call sites and it would be easy to update only one.
  const src = readFileSync("src/features/vector/components/VectorChart.tsx", "utf8");
  assert.match(src, /pickActiveStrikes\(trailMap, maxStrikes, \{ spot \}\)/, "picker receives spot");
  const passes = src.match(/^\s*spotRef\.current,?\s*$/gm) ?? [];
  assert.ok(
    passes.length >= 4,
    `all 4 applyWallBeadMarkers call sites (2 live + 2 replay) must pass spot, found ${passes.length}`
  );
  assert.match(src, /compareCompactBeadsRef\.current/, "compare compact beads threaded to bead markers");
});

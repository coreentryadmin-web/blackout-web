import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";
import { deriveGammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { deriveWallProximity } from "@/features/vector/lib/vector-wall-proximity";

/**
 * VECTOR FULL-STATE NUMERIC PRECISION — the fraction-of-one fields must survive the BIE/Largo
 * rounding boundary, and no two fields in the payload may share a key name at different scales.
 *
 * THE DEFECT THIS PINS. `computeVectorFullState` wraps its payload in `roundFloats(...)`. With the
 * default dp=2 that is correct for the dollar-scale majority (spot / strikes / wall levels / band
 * bounds) and DESTROYS every field that is a fraction of one, because 2dp quantizes to the nearest
 * 1%. Measured against live values captured 2026-08-07:
 *
 *   SPX  spot 7737.83  1sigma 31 pts   true movePct 0.004006  -> served 0     ("expected move 0.00%")
 *   NVDA spot 222.06   1sigma 2.71 pts true movePct 0.012204  -> served 0.01  (1.00% vs true 1.22%)
 *   SPX  magnet 7753.33                true distance 0.002004 -> served 0     (magnet "0% away")
 *
 * `VECTOR_FRACTION_DP` was centralized on 2026-08-07 to fix exactly this on
 * /api/market/vector/expected-move and /pin-forecast. The BIE boundary — which feeds
 * get_vector_full_state, get_vector_pulse and get_ecosystem_context.vector_full_state — never
 * adopted it, so Largo answered 0.00% while the /vector page showed 0.40% off the same read.
 *
 * `magnet.distancePct` could NOT be fixed by adding a map entry: `roundFloats` matches on the
 * IMMEDIATE key, and `proximity.distancePct` sits in the same payload as a PERCENT, so one
 * override cannot serve both. The unit was fixed at the source instead. The unit-agreement test
 * below is what stops that collision coming back.
 */

/** The live capture from vector-response-rounding.ts's header, reused so the two are comparable. */
const LIVE = [
  { ticker: "SPX", spot: 7737.83, move1: 31.0, call: 7800, put: 7700, flip: 7750 },
  { ticker: "NVDA", spot: 222.06, move1: 2.71, call: 224, put: 220, flip: 223 },
  { ticker: "ASTS", spot: 69.78, move1: 2.55, call: 71, put: 68, flip: 70 },
];

test("the BIE boundary passes VECTOR_FRACTION_DP to roundFloats", () => {
  // Read as source rather than executing: vector-full-state.ts is `server-only` and pulls the whole
  // provider graph, which cannot be imported under `tsx --test`. The assertion is that the call
  // site carries the override map at all — its absence is the entire defect.
  const src = readFileSync("src/lib/bie/vector-full-state.ts", "utf8");
  assert.match(
    src,
    /VECTOR_FRACTION_DP/,
    "computeVectorFullState must round with VECTOR_FRACTION_DP — bare roundFloats(dp=2) zeroes movePct/atmIv"
  );
  assert.match(src, /\}, 2, VECTOR_FRACTION_DP\)/, "the override map must be passed to the roundFloats CALL, not merely imported");
});

test("expectedMove fractions survive the boundary at their real magnitudes", () => {
  for (const c of LIVE) {
    const truePct = c.move1 / c.spot;
    const bare = (roundFloats({ movePct: truePct }) as { movePct: number }).movePct;
    const served = (roundFloats({ movePct: truePct }, 2, VECTOR_FRACTION_DP) as { movePct: number }).movePct;

    // The number the member reads is movePct * 100. Served must land within a basis point of true.
    assert.ok(
      Math.abs(served - truePct) < 1e-5,
      `${c.ticker}: movePct ${served} must track true ${truePct}`
    );
    // And the bare-default path must be demonstrably worse, or this test is not pinning anything.
    assert.ok(Math.abs(bare - truePct) > Math.abs(served - truePct), `${c.ticker}: dp=2 must be the worse path`);
  }
  // The headline regression: SPX's expected move must never serve as a hard zero again.
  const spx = LIVE[0]!;
  const spxServed = (roundFloats({ movePct: spx.move1 / spx.spot }, 2, VECTOR_FRACTION_DP) as { movePct: number }).movePct;
  assert.notEqual(spxServed, 0, "SPX 1sigma move served as 0 is the exact bug this guards");
});

test("atmIv keeps sub-vol-point resolution through the boundary", () => {
  // 14.49% vol at 2dp becomes 14% — half a vol point lost on a number members trade off.
  const served = (roundFloats({ atmIv: 0.1449 }, 2, VECTOR_FRACTION_DP) as { atmIv: number }).atmIv;
  assert.equal(served, 0.1449);
  assert.equal((roundFloats({ atmIv: 0.1449 }) as { atmIv: number }).atmIv, 0.14);
});

test("magnet.distancePct and proximity.distancePct are the SAME unit (percent)", () => {
  // The collision guard. These two share a key name inside one VectorFullState; if they ever drift
  // apart in scale again, the model receives two same-named numbers 100x apart with nothing in the
  // payload to distinguish them — and no single keyDp override can rescue it.
  for (const c of LIVE) {
    const walls = { callWalls: [{ strike: c.call, pct: 8 }], putWalls: [{ strike: c.put, pct: 7 }] };
    const magnet = deriveGammaMagnet({ spot: c.spot, walls, posture: "long" });
    const proximity = deriveWallProximity({ spot: c.spot, walls, gammaFlip: c.flip });
    assert.ok(magnet, `${c.ticker}: magnet must resolve`);
    assert.ok(proximity, `${c.ticker}: proximity must resolve`);

    // Both must equal ((level - spot) / spot) * 100 computed independently here.
    //
    // Tolerance is the cent-rounding of the strike, not an epsilon: `GammaMagnet.strike` is
    // round2()'d while its `distancePct` derives from the UNROUNDED center of mass, so recomputing
    // from the published strike is off by up to (0.01 / spot) * 100 percent. A tolerance tighter
    // than that fails on correct code; one 100x looser would not catch the unit regression, which
    // is what this test exists for.
    const centTol = (0.02 / c.spot) * 100;
    const expectMagnet = ((magnet!.strike - c.spot) / c.spot) * 100;
    const expectProx = ((proximity!.strike - c.spot) / c.spot) * 100;
    assert.ok(
      Math.abs(magnet!.distancePct - expectMagnet) < centTol,
      `${c.ticker}: magnet distancePct must be a PERCENT (got ${magnet!.distancePct}, expected ~${expectMagnet})`
    );
    assert.ok(
      Math.abs(proximity!.distancePct - expectProx) < centTol,
      `${c.ticker}: proximity distancePct must be a PERCENT (got ${proximity!.distancePct}, expected ~${expectProx})`
    );
    // The regression itself: a fraction would be ~100x smaller than the percent. Assert the two
    // fields are on ONE scale by requiring their ratio to the same independent computation to match.
    assert.ok(
      Math.abs(magnet!.distancePct) > Math.abs(expectMagnet) / 2,
      `${c.ticker}: magnet distancePct looks like a FRACTION, not a percent`
    );
  }
});

test("a percent-scale magnet distance is no longer zeroed by the default dp=2", () => {
  const c = LIVE[0]!;
  const walls = { callWalls: [{ strike: c.call, pct: 8 }], putWalls: [{ strike: c.put, pct: 7 }] };
  const magnet = deriveGammaMagnet({ spot: c.spot, walls, posture: "long" })!;
  // 0.20% survives 2dp as 0.2; the old fraction (0.002004) did not survive as anything but 0.
  const served = (roundFloats({ distancePct: magnet.distancePct }) as { distancePct: number }).distancePct;
  assert.notEqual(served, 0);
  assert.ok(Math.abs(served - magnet.distancePct) < 0.005);
});

test("the AT dead-band is unchanged by the rescale", () => {
  // AT_BAND_PCT moved 0.0015 -> 0.15 alongside the unit change. |frac| <= 0.0015 and
  // |frac*100| <= 0.15 are the same predicate, so `pull` must classify identically — the play
  // engine reads `pull`, so any drift here would silently change play selection.
  const spot = 100;
  // Magnet lands at the strength-weighted mean of the walls; equal weights put it midway.
  const atBand = deriveGammaMagnet({
    spot,
    walls: { callWalls: [{ strike: 100.1, pct: 5 }], putWalls: [{ strike: 100.1, pct: 5 }] },
    posture: "long",
  });
  assert.equal(atBand!.pull, "at", "0.10% away is inside the 0.15% dead-band");

  const outsideBand = deriveGammaMagnet({
    spot,
    walls: { callWalls: [{ strike: 100.5, pct: 5 }], putWalls: [{ strike: 100.5, pct: 5 }] },
    posture: "long",
  });
  assert.equal(outsideBand!.pull, "up", "0.50% away is outside the dead-band");
});

test("Vector fractions survive BOTH rounding stages — the BIE boundary AND the reader transform", async () => {
  // The BIE boundary (VECTOR_FRACTION_DP) is only the FIRST stage. Every tool result then passes
  // through the guarded runner's roundResultForReading before the model sees it. Neither stage in
  // isolation proves the fraction reaches Largo — only the COMPOSITION does, and nothing tested it:
  // the live boundary probe (vector-largo-boundary-live.mjs) was the sole check and it modelled the
  // reader as a bare roundFloats(dp=2), so it reported the FIXED surface as broken (0.01). This is
  // that missing end-to-end guard.
  const { roundResultForReading } = await import("@/lib/largo/core/round-for-reading");
  // roundResultForReading keeps 6 significant digits below 1; a fraction like 0.004006 must survive.
  for (const { movePct } of [{ movePct: 0.004006 }, { movePct: 0.012204 }, { movePct: 0.005431 }]) {
    const afterBie = roundFloats({ movePct }, 2, VECTOR_FRACTION_DP);
    const afterReader = roundResultForReading(afterBie);
    assert.equal(afterReader.movePct, movePct, "the fraction must reach the model intact, both stages composed");
    // And the pre-#2423 bare dp=2 path collapses it — the exact regression the two stages prevent.
    assert.notEqual(roundFloats({ movePct }).movePct, movePct);
  }
  // A sub-1% move must never arrive as a literal 0 after both stages (the original member-visible harm).
  const tiny = roundResultForReading(roundFloats({ movePct: 0.004006 }, 2, VECTOR_FRACTION_DP));
  assert.notEqual(tiny.movePct, 0, "a 0.40% expected move must not reach Largo as 0.00%");
});

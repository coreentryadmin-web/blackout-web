import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWallProximity } from "./vector-wall-proximity";

const walls = {
  callWalls: [{ strike: 7600, pct: 6, gex: 3e9 }],
  putWalls: [{ strike: 7500, pct: 5, gex: -2e9 }],
};

test("returns null when spot is in open space (no level within band)", () => {
  assert.equal(deriveWallProximity({ spot: 7550, walls, gammaFlip: 7400, bandPct: 0.3 }), null);
});

test("picks the nearest level within the band — call wall above", () => {
  const p = deriveWallProximity({ spot: 7595, walls, gammaFlip: 7400, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "call");
  assert.equal(p!.strike, 7600);
  assert.ok(p!.distancePct > 0); // above spot
  assert.match(p!.callout, /call wall/);
  assert.match(p!.callout, /sell into strength/);
});

test("put wall below → support callout", () => {
  const p = deriveWallProximity({ spot: 7505, walls, gammaFlip: 7400, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "put");
  assert.match(p!.callout, /put wall/);
  assert.match(p!.callout, /buy weakness/);
});

test("put wall overhead (spot fell through it) → support-broken caution, NOT dip-buy", () => {
  // spot 7498 is below the 7500 put wall (0.027% away, inside the band): support has been lost.
  const p = deriveWallProximity({ spot: 7498, walls, gammaFlip: 7000, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "put");
  assert.ok(p!.distancePct > 0); // strike is overhead
  assert.match(p!.callout, /support gave way/);
  // must never narrate a bullish reclaim/dip-buy when spot is UNDER the put wall
  assert.doesNotMatch(p!.callout, /dip-buy|reclaimed/i);
});

test("call wall broken through (spot cleared it) → resistance-cleared caution, NOT back-under/lost-magnet", () => {
  // spot 7602 is above the 7600 call wall (0.026% away, inside the band): resistance has broken.
  const p = deriveWallProximity({ spot: 7602, walls, gammaFlip: 7000, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "call");
  assert.ok(p!.distancePct < 0); // strike is now below spot
  assert.match(p!.callout, /resistance gave way/);
  // must never narrate spot as still under/testing a call wall it has actually broken above
  assert.doesNotMatch(p!.callout, /back under|lost magnet/i);
});

test("gamma flip proximity → regime-hinge callout wins when closest", () => {
  // flip (7501, 0.013% away) is closer than the put wall (7500, 0.027%).
  const p = deriveWallProximity({
    spot: 7502,
    walls,
    gammaFlip: 7501,
    bandPct: 0.5,
  });
  assert.ok(p);
  assert.equal(p!.side, "flip");
  assert.match(p!.callout, /flips the regime/);
});

test("nearness tiers scale with distance", () => {
  const at = deriveWallProximity({ spot: 7599.5, walls, gammaFlip: 7000, bandPct: 0.6 });
  assert.equal(at!.nearness, "at");
  const near = deriveWallProximity({ spot: 7566, walls, gammaFlip: 7000, bandPct: 0.6 });
  assert.equal(near!.side, "call");
  assert.equal(near!.nearness, "near");
});

test("invalid spot → null (never fabricates a level)", () => {
  assert.equal(deriveWallProximity({ spot: null, walls, gammaFlip: 7500 }), null);
  assert.equal(deriveWallProximity({ spot: 0, walls, gammaFlip: 7500 }), null);
});

// BUG FIX (2026-08-27, live evidence: NVDA's play flipped grade B -> A between two reads 25s
// apart on a 0.06% spot move, because `nearness` crossed testing->at with no hysteresis). These
// tests use round numbers (strike 1000, band 0.6) so the tier boundaries are clean:
// atIn=0.2%, testingIn=0.4%, atOut=0.25% (atIn * 1.25), testingOut=0.5% (testingIn * 1.25).
const roundWalls = { callWalls: [{ strike: 1000, pct: 6, gex: 3e9 }], putWalls: [] };

test("hysteresis: a tracked level does NOT downgrade at the plain exit threshold, only past the widened one", () => {
  const at = deriveWallProximity({ spot: 998.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6 });
  assert.equal(at!.nearness, "at"); // dist ~0.15%, inside atIn(0.2)

  // Next read: dist ~0.22% -- ABOVE atIn(0.2) so a fresh read would say "testing", but this is the
  // SAME level (call wall @ 1000) previously read as "at", and 0.22 <= atOut(0.25) -> stays "at".
  const stillAt = deriveWallProximity({ spot: 997.8, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: at });
  assert.equal(stillAt!.nearness, "at");

  // Next read: dist ~0.25% -- past atOut(0.25) -> now genuinely downgrades to "testing".
  const testing = deriveWallProximity({ spot: 997.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: stillAt });
  assert.equal(testing!.nearness, "testing");

  // Next read: dist ~0.45% -- past testingIn(0.4) so a fresh read would say "near", but this is
  // the SAME level previously "testing", and 0.45 <= testingOut(0.5) -> stays "testing".
  const stillTesting = deriveWallProximity({ spot: 995.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: testing });
  assert.equal(stillTesting!.nearness, "testing");

  // Next read: dist ~0.55% -- past testingOut(0.5) -> now genuinely downgrades to "near".
  const near = deriveWallProximity({ spot: 994.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: stillTesting });
  assert.equal(near!.nearness, "near");
});

test("hysteresis: a fresh read (no prev) uses the plain tight thresholds, never the widened exit ones", () => {
  // Same dist (~0.22%, spot 997.8) as the "stillAt" case above, but with NO prior context: the
  // plain rule classifies it "testing" -- proving the "at" result above came from hysteresis
  // tracking the level, not from this distance alone being "at" on its own merits.
  const p = deriveWallProximity({ spot: 997.8, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: null });
  assert.equal(p!.nearness, "testing");
});

test("hysteresis: a tracked level stays IN the band past the plain band edge, up to the widened exit band", () => {
  const at = deriveWallProximity({ spot: 998.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6 });
  // dist ~0.65% is PAST band(0.6) -- a fresh read returns null -- but tracking the same level and
  // within exitBand (0.6 * 1.25 = 0.75) keeps it alive rather than dropping to null outright.
  const stillTracked = deriveWallProximity({ spot: 993.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: at });
  assert.ok(stillTracked, "a tracked level should not vanish on a sub-tick move past the plain band edge");
  assert.equal(stillTracked!.nearness, "near");

  // Without tracking (fresh read, no prev), the same spot correctly returns null -- the widened
  // exit band must never apply to a level nothing was previously watching.
  const fresh = deriveWallProximity({ spot: 993.5, walls: roundWalls, gammaFlip: null, bandPct: 0.6, prev: null });
  assert.equal(fresh, null);
});

test("hysteresis: switching to a genuinely different level (different side) does not inherit the old level's nearness", () => {
  const twoWalls = { callWalls: [{ strike: 1000, pct: 6, gex: 3e9 }], putWalls: [{ strike: 900, pct: 5, gex: -2e9 }] };
  const atCallWall = deriveWallProximity({ spot: 998.5, walls: twoWalls, gammaFlip: null, bandPct: 0.6 });
  assert.equal(atCallWall!.side, "call");
  assert.equal(atCallWall!.nearness, "at");
  // Now spot is near the PUT wall instead -- a completely different level. Even though `prev` is
  // passed, it must not apply the call-wall's "at" hysteresis to this unrelated put-wall read.
  const nearPutWall = deriveWallProximity({ spot: 903.6, walls: twoWalls, gammaFlip: null, bandPct: 0.6, prev: atCallWall });
  assert.ok(nearPutWall);
  assert.equal(nearPutWall!.side, "put");
  assert.equal(nearPutWall!.nearness, "testing"); // plain threshold, not inherited from the call wall's "at"
});

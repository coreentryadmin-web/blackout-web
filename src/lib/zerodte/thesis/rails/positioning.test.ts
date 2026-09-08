import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPositioningArchetype, scorePositioningRail } from "./positioning";

// Regression: VACUUM/WALL_REJECTION and the short-gamma bonus used to be gated
// `&& input.direction === "long"` with no symmetric case for "short" -- a short candidate under
// geometrically MIRRORED dealer positioning got zero archetype credit at all, while every sibling
// rail (rs.ts, breakout.ts, vol.ts, reversal.ts) is direction-symmetric.

test("VACUUM: long gets credit for room UP toward the call wall", () => {
  const archetype = detectPositioningArchetype({
    ticker: "SPY",
    direction: "long",
    spot: 100,
    call_wall: 104, // 4% above spot
    put_wall: 80,
  });
  assert.equal(archetype, "VACUUM");
});

test("VACUUM: short gets SYMMETRIC credit for room DOWN toward the put wall", () => {
  const archetype = detectPositioningArchetype({
    ticker: "SPY",
    direction: "short",
    spot: 100,
    call_wall: 120,
    put_wall: 96, // 4% below spot -- the geometric mirror of the long fixture above
  });
  assert.equal(archetype, "VACUUM", "a short candidate must earn VACUUM under mirrored geometry");
});

test("WALL_REJECTION: long gets credit when spot is pinned just above the put wall", () => {
  const archetype = detectPositioningArchetype({
    ticker: "SPY",
    direction: "long",
    spot: 100,
    call_wall: 120,
    put_wall: 99.2, // within 1% below spot
  });
  assert.equal(archetype, "WALL_REJECTION");
});

test("WALL_REJECTION: short gets SYMMETRIC credit when spot is pinned just below the call wall", () => {
  const archetype = detectPositioningArchetype({
    ticker: "SPY",
    direction: "short",
    spot: 100,
    call_wall: 100.8, // within 1% above spot -- the geometric mirror of the long fixture above
    put_wall: 80,
  });
  assert.equal(
    archetype,
    "WALL_REJECTION",
    "a short candidate must earn WALL_REJECTION under mirrored geometry"
  );
});

test("scorePositioningRail: a short VACUUM setup is no longer silently dropped to a null rail hit", () => {
  const hit = scorePositioningRail({
    ticker: "SPY",
    direction: "short",
    spot: 100,
    call_wall: 120,
    put_wall: 96,
  });
  assert.ok(hit, "the rail must fire for a short VACUUM, matching the long case");
  assert.equal(hit!.score, 74);
  assert.equal(hit!.positioning_archetype, "VACUUM");
});

test("short-gamma bonus is direction-neutral: applies to short candidates too", () => {
  const long = scorePositioningRail({
    ticker: "SPY",
    direction: "long",
    spot: 100,
    call_wall: null,
    put_wall: null,
    gamma_posture: "short",
  });
  const short = scorePositioningRail({
    ticker: "SPY",
    direction: "short",
    spot: 100,
    call_wall: null,
    put_wall: null,
    gamma_posture: "short",
  });
  assert.equal(long!.score, short!.score, "short-gamma amplification applies to either direction");
});

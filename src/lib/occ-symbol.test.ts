import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOcc } from "./occ-symbol";

test("buildOcc: standard equity call, whole-dollar strike", () => {
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", 150), "O:AAPL260918C00150000");
});

test("buildOcc: standard equity put, fractional strike", () => {
  assert.equal(buildOcc("TSLA", "2026-12-19", "put", 250.5), "O:TSLA261219P00250500");
});

test("buildOcc: SPX is rewritten to the SPXW root (Polygon/Massive OCC convention)", () => {
  const occ = buildOcc("SPX", "2026-09-06", "call", 6500);
  assert.ok(occ, "expected a non-null OCC symbol");
  assert.match(occ!, /^O:SPXW/);
  assert.equal(occ, "O:SPXW260906C06500000");
});

test("buildOcc: SPXW passed directly is left as SPXW, not double-prefixed", () => {
  const occ = buildOcc("SPXW", "2026-09-06", "call", 6500);
  assert.equal(occ, "O:SPXW260906C06500000");
});

test("buildOcc: ticker is trimmed and uppercased", () => {
  assert.equal(buildOcc("  aapl  ", "2026-09-18", "call", 150), "O:AAPL260918C00150000");
});

test("buildOcc: full ISO timestamp expiry is truncated to the date portion", () => {
  assert.equal(
    buildOcc("AAPL", "2026-09-18T00:00:00.000Z", "call", 150),
    "O:AAPL260918C00150000",
  );
});

test("buildOcc: strike is scaled by 1000 and zero-padded to 8 digits", () => {
  const occ = buildOcc("AAPL", "2026-09-18", "call", 1.5);
  assert.equal(occ, "O:AAPL260918C00001500");
});

test("buildOcc: sub-cent floating point strike rounds cleanly (no float noise in output)", () => {
  // 99.99 * 1000 is 99989.99999999999 in IEEE-754 — must round, not truncate or leak decimals.
  const occ = buildOcc("AAPL", "2026-09-18", "call", 99.99);
  assert.equal(occ, "O:AAPL260918C00099990");
});

test("buildOcc: null for empty ticker", () => {
  assert.equal(buildOcc("", "2026-09-18", "call", 150), null);
  assert.equal(buildOcc("   ", "2026-09-18", "call", 150), null);
});

test("buildOcc: null for a root outside 1-6 uppercase letters", () => {
  assert.equal(buildOcc("TOOLONGTICKER", "2026-09-18", "call", 150), null);
  assert.equal(buildOcc("AA1", "2026-09-18", "call", 150), null);
});

test("buildOcc: null for a malformed expiry date", () => {
  assert.equal(buildOcc("AAPL", "2026-9-18", "call", 150), null);
  assert.equal(buildOcc("AAPL", "not-a-date", "call", 150), null);
  assert.equal(buildOcc("AAPL", "", "call", 150), null);
});

test("buildOcc: null for an option type that is neither call nor put", () => {
  assert.equal(buildOcc("AAPL", "2026-09-18", "straddle" as "call", 150), null);
});

test("buildOcc: null for a non-positive or non-finite strike", () => {
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", 0), null);
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", -10), null);
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", NaN), null);
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", Infinity), null);
});

test("buildOcc: null for a strike that overflows the 8-digit OCC field", () => {
  // 99_999_999 is the max 8-digit value; strike * 1000 must not exceed it.
  assert.equal(buildOcc("AAPL", "2026-09-18", "call", 100_000), null);
  assert.ok(buildOcc("AAPL", "2026-09-18", "call", 99_999.999) != null);
});

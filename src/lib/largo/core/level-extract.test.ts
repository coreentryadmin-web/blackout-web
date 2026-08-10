import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLevels } from "./level-extract";

const ev = (text: string, source?: string) => ({
  kind: "fact" as const,
  text,
  ...(source ? { provenance: { source, freshness: "live" as const } } : {}),
});

test("lifts the levels a desk read leads with", () => {
  const levels = extractLevels([
    ev("SPX spot 6412.18, +0.4% on the session", "Polygon quote"),
    ev("Call wall 6425 with heavy dealer gamma", "Thermal GEX"),
    ev("Put wall sits at 6380"),
    ev("Gamma flip: 6397"),
    ev("Price is holding above the 6405.32 VWAP"),
  ]);
  assert.deepEqual(
    levels.map((l) => [l.label, l.price]),
    [
      ["Gamma flip", 6397],
      ["Call wall", 6425],
      ["Put wall", 6380],
      ["VWAP", 6405.32],
      ["Spot", 6412.18],
    ]
  );
});

test("carries provenance and never invents it", () => {
  const levels = extractLevels([ev("Call wall 6425", "Thermal GEX"), ev("Put wall 6380")]);
  assert.equal(levels.find((l) => l.label === "Call wall")?.provenance?.source, "Thermal GEX");
  assert.equal(levels.find((l) => l.label === "Put wall")?.provenance, undefined);
});

test("movement is never mistaken for a price", () => {
  // The whole reason the grid was empty is safer than the grid being wrong.
  assert.deepEqual(extractLevels([ev("SPX spot +2.31% on the day")]), []);
  assert.deepEqual(extractLevels([ev("Call wall shifted -12 overnight")]), []);
  assert.deepEqual(extractLevels([ev("Spot 0")]), []);
});

test("a competing label between number and label breaks the binding", () => {
  // "VWAP reclaimed, SPX 6412" must NOT bind 6412 to VWAP.
  const levels = extractLevels([ev("VWAP reclaimed, spot 6412.18")]);
  assert.deepEqual(levels.map((l) => l.label), ["Spot"]);
  assert.equal(levels[0]!.price, 6412.18);
});

test("non-price figures never enter a price grid", () => {
  // An open label rule would put $18.2M of premium in the levels row.
  assert.deepEqual(extractLevels([ev("Call premium +$18.2M"), ev("Volume 1,204,000")]), []);
});

test("first mention wins over a later restatement", () => {
  const levels = extractLevels([ev("Call wall 6425"), ev("Call wall may migrate to 6450")]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0]!.price, 6425);
});

test("empty or malformed evidence yields no levels, never a throw", () => {
  assert.deepEqual(extractLevels([]), []);
  assert.deepEqual(extractLevels([{ kind: "fact", text: "" } as never]), []);
  assert.deepEqual(extractLevels([{ kind: "fact" } as never]), []);
});

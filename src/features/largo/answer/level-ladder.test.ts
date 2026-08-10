import test from "node:test";
import assert from "node:assert/strict";
import { ladderFromLevels, kindOfLevel } from "./level-ladder";
import type { BieLevel } from "@/lib/bie/answer-envelope";

/** Shaped like a real answer's extracted levels, including the anomalous above-spot put wall. */
const LEVELS: BieLevel[] = [
  { label: "Spot", price: 7752.65 },
  { label: "Call wall", price: 7800 },
  { label: "Put wall", price: 8000 },
  { label: "Gamma flip", price: 7771.1 },
  { label: "VWAP", price: 7753.32 },
];

test("levels order by price with spot marked in its true position", () => {
  assert.deepEqual(
    ladderFromLevels(LEVELS).map((r) => r.label),
    ["PUT WALL", "CALL WALL", "GAMMA FLIP", "VWAP", "SPOT"]
  );
});

test("the spot row is the marker, and is not duplicated as a level", () => {
  const rows = ladderFromLevels(LEVELS);
  assert.equal(rows.filter((r) => r.isSpot).length, 1);
  // "Spot" must not appear twice — once as the marker and once as an ordinary rung.
  assert.equal(rows.filter((r) => r.label === "SPOT").length, 1);
});

test("without a spot level there is no marker and no distances", () => {
  // A distance measured from a spot the answer never gave is a fabricated number in real styling.
  const rows = ladderFromLevels(LEVELS.filter((l) => l.label !== "Spot"));
  assert.equal(rows.some((r) => r.isSpot), false);
  assert.equal(rows.every((r) => r.distancePct === null), true);
});

test("kinds are named only where they are certain", () => {
  assert.equal(kindOfLevel("Call wall"), "call-wall");
  assert.equal(kindOfLevel("Put wall"), "put-wall");
  assert.equal(kindOfLevel("Gamma flip"), "gamma-flip");
  assert.equal(kindOfLevel("Max pain"), "max-pain");
  assert.equal(kindOfLevel("Spot"), "spot");
  // A VWAP mislabelled as a gamma flip would be a WRONG row — generic is the safe answer.
  assert.equal(kindOfLevel("VWAP"), "level");
  assert.equal(kindOfLevel("Prior high"), "level");
  assert.equal(kindOfLevel(""), "level");
});

test("non-numeric and missing prices are dropped, never rendered as 0", () => {
  const messy = [
    { label: "Spot", price: 100 },
    { label: "Call wall", price: null as unknown as number },
    { label: "Put wall", price: Number.NaN },
    { label: "VWAP", price: 99 },
  ] as BieLevel[];
  const rows = ladderFromLevels(messy);
  assert.deepEqual(rows.map((r) => r.label), ["SPOT", "VWAP"]);
  assert.equal(rows.some((r) => r.price === 0), false);
});

test("the ladder stays scannable — rungs are capped", () => {
  const many: BieLevel[] = [
    { label: "Spot", price: 100 },
    ...Array.from({ length: 20 }, (_, i) => ({ label: `Level ${i}`, price: 100 + i })),
  ];
  // 8 levels plus the spot marker.
  assert.equal(ladderFromLevels(many).length, 9);
});

test("empty input yields an empty ladder, and the caller renders nothing", () => {
  assert.deepEqual(ladderFromLevels([]), []);
  assert.deepEqual(ladderFromLevels(undefined), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLevelLadder,
  formatDistance,
  movedLevels,
  readAgeSeconds,
  type RailLevelInput,
} from "./rail-levels";

/** The exact live SPX read from 2026-08-10 that motivated the ladder — put wall ABOVE spot. */
const LIVE_SPX: RailLevelInput[] = [
  { label: "CALL WALL", price: 7800, kind: "call-wall" },
  { label: "PUT WALL", price: 8000, kind: "put-wall" },
  { label: "GAMMA FLIP", price: 7772.02, kind: "gamma-flip" },
  { label: "MAX PAIN", price: 7500, kind: "max-pain" },
];

test("ladder orders by price and places spot in its true position", () => {
  const rows = buildLevelLadder(7754.88, LIVE_SPX);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["PUT WALL", "CALL WALL", "GAMMA FLIP", "SPOT", "MAX PAIN"]
  );
  // The whole point: the put wall renders ABOVE spot, so it cannot be misread as support.
  assert.equal(rows.findIndex((r) => r.label === "PUT WALL") < rows.findIndex((r) => r.isSpot), true);
});

test("distances are signed relative to spot", () => {
  const rows = buildLevelLadder(7754.88, LIVE_SPX);
  const by = (l: string) => rows.find((r) => r.label === l)!;
  assert.equal(formatDistance(by("PUT WALL").distancePct), "+3.16%");
  assert.equal(formatDistance(by("CALL WALL").distancePct), "+0.58%");
  assert.equal(formatDistance(by("MAX PAIN").distancePct), "−3.29%");
  assert.equal(formatDistance(by("SPOT").distancePct), "0.00%");
});

test("null levels are dropped, never rendered as zero", () => {
  const rows = buildLevelLadder(100, [
    { label: "CALL WALL", price: null, kind: "call-wall" },
    { label: "PUT WALL", price: 90, kind: "put-wall" },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["SPOT", "PUT WALL"]);
  assert.equal(rows.some((r) => r.price === 0), false);
});

test("no spot means no distances and no spot row — not a 0 origin", () => {
  const rows = buildLevelLadder(null, LIVE_SPX);
  assert.equal(rows.some((r) => r.isSpot), false);
  assert.equal(rows.every((r) => r.distancePct === null), true);
  assert.equal(formatDistance(rows[0]!.distancePct), "—");
});

test("a level pinned exactly at spot keeps its own row, above the marker", () => {
  const rows = buildLevelLadder(7772.02, [{ label: "GAMMA FLIP", price: 7772.02, kind: "gamma-flip" }]);
  assert.deepEqual(rows.map((r) => r.label), ["GAMMA FLIP", "SPOT"]);
});

test("movedLevels flags a migrated wall and ignores spot drift", () => {
  const prev = buildLevelLadder(7750, LIVE_SPX);
  const next = buildLevelLadder(7760, [{ ...LIVE_SPX[0]!, price: 7850 }, ...LIVE_SPX.slice(1)]);
  assert.deepEqual([...movedLevels(prev, next)], ["CALL WALL"]);
});

test("a level appearing for the first time is not movement", () => {
  const prev = buildLevelLadder(100, [{ label: "PUT WALL", price: 90, kind: "put-wall" }]);
  const next = buildLevelLadder(100, [
    { label: "PUT WALL", price: 90, kind: "put-wall" },
    { label: "CALL WALL", price: 110, kind: "call-wall" },
  ]);
  assert.equal(movedLevels(prev, next).size, 0);
  // ...and there is nothing to compare against on the very first read.
  assert.equal(movedLevels(null, next).size, 0);
});

test("read age: unknown stays unknown, never 0", () => {
  const now = Date.parse("2026-08-10T14:00:00.000Z");
  assert.equal(readAgeSeconds("2026-08-10T13:59:18.000Z", now), 42);
  assert.equal(readAgeSeconds(null, now), null);
  assert.equal(readAgeSeconds("not a date", now), null);
  // Server clock slightly ahead is skew, not a read from the future.
  assert.equal(readAgeSeconds("2026-08-10T14:00:03.000Z", now), 0);
});

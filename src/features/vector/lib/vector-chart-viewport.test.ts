import assert from "node:assert/strict";
import test from "node:test";
import { sessionVisibleLogicalRange, zoomedLogicalRange } from "./vector-chart-viewport";

const et = (ymd: string, hh: number, mm: number) =>
  Math.floor(Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`) / 1000);

function sessionBars(ymd: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ time: et(ymd, 9, 30) + i * 60 }));
}

const fri = sessionBars("2026-07-10", 3);
const mon = sessionBars("2026-07-13", 4);
const multi = [...fri, ...mon];

test("sessionVisibleLogicalRange: frames only the trailing ET session", () => {
  const range = sessionVisibleLogicalRange(multi);
  assert.deepEqual(range, { from: fri.length, to: multi.length - 1 + 2 });
});

test("sessionVisibleLogicalRange: single session spans full array", () => {
  const range = sessionVisibleLogicalRange(mon);
  assert.deepEqual(range, { from: 0, to: mon.length - 1 + 2 });
});

test("sessionVisibleLogicalRange: empty bars → null", () => {
  assert.equal(sessionVisibleLogicalRange([]), null);
});

test("zoomedLogicalRange: scales the range around its own center", () => {
  // span 20, center 50 -> zoom IN by 0.5 -> span 10, same center
  const range = zoomedLogicalRange({ from: 40, to: 60 }, 0.5, 6);
  assert.deepEqual(range, { from: 45, to: 55 });
});

test("zoomedLogicalRange: zoom OUT grows the range around the same center", () => {
  const range = zoomedLogicalRange({ from: 40, to: 60 }, 2, 6);
  assert.deepEqual(range, { from: 30, to: 70 });
});

test("zoomedLogicalRange: floors at minSpan so zoom-in cannot collapse the range", () => {
  // span 8, zoom in by 0.1 would want span 0.8 — clamp to minSpan (6) instead.
  const range = zoomedLogicalRange({ from: 10, to: 18 }, 0.1, 6);
  assert.deepEqual(range, { from: 11, to: 17 });
});

test("zoomedLogicalRange: degenerate/invalid inputs return null rather than NaN", () => {
  assert.equal(zoomedLogicalRange({ from: 10, to: 10 }, 0.5, 6), null);
  assert.equal(zoomedLogicalRange({ from: 10, to: 20 }, 0, 6), null);
  assert.equal(zoomedLogicalRange({ from: 10, to: 20 }, -1, 6), null);
});

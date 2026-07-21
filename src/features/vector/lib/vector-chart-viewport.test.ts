import assert from "node:assert/strict";
import test from "node:test";
import { sessionVisibleLogicalRange } from "./vector-chart-viewport";

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

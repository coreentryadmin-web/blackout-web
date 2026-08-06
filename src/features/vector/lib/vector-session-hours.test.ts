import { test } from "node:test";
import assert from "node:assert/strict";
import { isRthBarSec, filterRthBarsSec } from "./vector-session-hours";

// 2026-08-05 is a Wednesday, no DST ambiguity concerns for this fixed test date. ET is UTC-4 (EDT).
function etSec(hour: number, minute: number): number {
  return Date.UTC(2026, 7, 5, hour + 4, minute, 0) / 1000;
}

test("isRthBarSec: 09:29 ET (one minute before open) is NOT RTH", () => {
  assert.equal(isRthBarSec(etSec(9, 29)), false);
});

test("isRthBarSec: 09:30 ET (the open) IS RTH", () => {
  assert.equal(isRthBarSec(etSec(9, 30)), true);
});

test("isRthBarSec: 12:00 ET (midday) IS RTH", () => {
  assert.equal(isRthBarSec(etSec(12, 0)), true);
});

test("isRthBarSec: 15:59 ET (one minute before close) IS RTH", () => {
  assert.equal(isRthBarSec(etSec(15, 59)), true);
});

test("isRthBarSec: 16:00 ET (the close) is NOT RTH (half-open)", () => {
  assert.equal(isRthBarSec(etSec(16, 0)), false);
});

test("isRthBarSec: 04:00 ET premarket is NOT RTH", () => {
  assert.equal(isRthBarSec(etSec(4, 0)), false);
});

test("isRthBarSec: 18:00 ET after-hours is NOT RTH", () => {
  assert.equal(isRthBarSec(etSec(18, 0)), false);
});

test("isRthBarSec: non-finite input is NOT RTH (never throws)", () => {
  assert.equal(isRthBarSec(NaN), false);
  assert.equal(isRthBarSec(Infinity), false);
});

test("filterRthBarsSec: drops premarket/after-hours bars, keeps RTH bars, preserves order", () => {
  const bars = [
    { time: etSec(4, 0), tag: "premarket" },
    { time: etSec(9, 30), tag: "open" },
    { time: etSec(12, 0), tag: "midday" },
    { time: etSec(15, 59), tag: "last-rth" },
    { time: etSec(16, 0), tag: "close" },
    { time: etSec(18, 0), tag: "after-hours" },
  ];
  const filtered = filterRthBarsSec(bars);
  assert.deepEqual(
    filtered.map((b) => b.tag),
    ["open", "midday", "last-rth"]
  );
});

test("filterRthBarsSec: empty input returns empty", () => {
  assert.deepEqual(filterRthBarsSec([]), []);
});

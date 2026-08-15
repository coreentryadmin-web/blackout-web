import assert from "node:assert/strict";
import test from "node:test";
import {
  etEpochForYmdMinutes,
  etYmdFromBarSec,
  extendedHoursShadeBands,
  isRthBarSec,
} from "@/features/vector/lib/vector-session-hours";

function etSec(hour: number, minute: number): number {
  return Date.UTC(2026, 7, 5, hour + 4, minute, 0) / 1000;
}

test("extendedHoursShadeBands: empty when all bars are RTH", () => {
  assert.deepEqual(
    extendedHoursShadeBands([
      { time: etSec(10, 0) },
      { time: etSec(15, 0) },
    ]),
    []
  );
});

test("extendedHoursShadeBands: pre/post windows for days with extended prints", () => {
  const bands = extendedHoursShadeBands([
    { time: etSec(4, 15) },
    { time: etSec(10, 0) },
    { time: etSec(17, 30) },
  ]);
  assert.equal(bands.length, 2);
  assert.equal(bands[0]!.kind, "premarket");
  assert.equal(bands[1]!.kind, "afterhours");
  assert.ok(bands[0]!.fromSec < bands[0]!.toSec);
  assert.ok(bands[1]!.fromSec < bands[1]!.toSec);
  assert.equal(isRthBarSec(bands[0]!.fromSec), false);
  assert.equal(isRthBarSec(bands[0]!.toSec - 60), false);
});

test("etEpochForYmdMinutes: round-trips ET wall clock", () => {
  const ymd = etYmdFromBarSec(etSec(10, 5));
  const open = etEpochForYmdMinutes(ymd, 9 * 60 + 30);
  assert.equal(isRthBarSec(open), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { extractGexShifts, formatGexChange } from "./gex-shift-extract";

/** Shaped exactly like `GexMatrixChangesForLargo`, with the live numbers from the screenshot. */
const TOOL_RESULT = {
  ticker: "SPX",
  available: true,
  asof: "2026-08-10T14:38:22Z",
  previous_asof: "2026-08-10T14:37:22Z",
  updated_strikes: [
    { strike: 7800, gex_change: -177_800_000, direction: "weaker" },
    { strike: 7775, gex_change: -293_600_000, direction: "weaker" },
    { strike: 7725, gex_change: 310_900_000, direction: "stronger" },
  ],
};

test("the table is read from the raw tool result, by structure", () => {
  const t = extractGexShifts([{ some: "other tool" }, TOOL_RESULT])!;
  assert.equal(t.shifts.length, 3);
  assert.equal(t.asOf, "2026-08-10T14:38:22Z");
  assert.equal(t.previousAsOf, "2026-08-10T14:37:22Z");
});

test("rows are ordered by SIZE of move, so a cap keeps the largest", () => {
  const t = extractGexShifts([TOOL_RESULT], 2)!;
  assert.deepEqual(t.shifts.map((s) => s.strike), [7725, 7775]);
});

test("direction comes from the tool — `flipped` is a third state a sign test cannot express", () => {
  const flipped = {
    updated_strikes: [{ strike: 7700, gex_change: -50_000_000, direction: "flipped" }],
  };
  assert.equal(extractGexShifts([flipped])!.shifts[0]!.direction, "flipped");
});

test("not-called and nothing-moved are different — one is null, one is a table", () => {
  // The tool was never called: no table at all.
  assert.equal(extractGexShifts([{ unrelated: true }]), null);
  assert.equal(extractGexShifts([]), null);
  assert.equal(extractGexShifts(null), null);
  // Called but every row malformed: also null, because we cannot claim nothing moved.
  assert.equal(extractGexShifts([{ updated_strikes: [{ strike: "x" }] }]), null);
});

test("called with a genuinely EMPTY updated_strikes is a real, checked no-move result — a table, not null", () => {
  // gexMatrixChangesForLargo's actual shape when spot moved but no strike exceeded the change
  // threshold: the tool ran, updated_strikes is [], and that is a fact worth rendering, not the
  // same "we did not look" state as never having called the tool at all.
  const noMove = {
    ticker: "SPX",
    asof: "2026-08-10T14:38:22Z",
    previous_asof: "2026-08-10T14:37:22Z",
    updated_strikes: [],
  };
  const t = extractGexShifts([noMove]);
  assert.notEqual(t, null, "a genuinely empty result must not read as unchecked");
  assert.deepEqual(t!.shifts, []);
  assert.equal(t!.asOf, "2026-08-10T14:38:22Z");
  assert.equal(t!.previousAsOf, "2026-08-10T14:37:22Z");
});

test("a partially-formed row is dropped, never rendered with a blank change", () => {
  const messy = {
    updated_strikes: [
      { strike: 7800, gex_change: -1_000_000, direction: "weaker" },
      { strike: 7775, direction: "weaker" }, // no change
      { strike: 7750, gex_change: 5_000_000 }, // no direction
      { strike: 7725, gex_change: 2_000_000, direction: "sideways" }, // unknown direction
    ],
  };
  const t = extractGexShifts([messy])!;
  assert.deepEqual(t.shifts.map((s) => s.strike), [7800]);
});

test("missing timestamps stay null rather than becoming a fake window", () => {
  const t = extractGexShifts([{ updated_strikes: TOOL_RESULT.updated_strikes }])!;
  assert.equal(t.asOf, null);
  assert.equal(t.previousAsOf, null);
});

test("change formatting is signed and compact", () => {
  assert.equal(formatGexChange(-177_800_000), "−$177.8M");
  assert.equal(formatGexChange(310_900_000), "+$310.9M");
  assert.equal(formatGexChange(7_030_000_000), "+$7.0B");
  assert.equal(formatGexChange(-4200), "−$4K");
  assert.equal(formatGexChange(0), "+$0");
});

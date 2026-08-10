import { test } from "node:test";
import assert from "node:assert/strict";
import { groupConversationsByDay, etDayKey, etClock } from "./session-grouping";

// 2026-08-10 is a Monday. 14:32 UTC = 10:32 ET (EDT, UTC-4).
const MON_1032_ET = Date.parse("2026-08-10T14:32:00Z");
const MON_0948_ET = Date.parse("2026-08-10T13:48:00Z");
const SUN_1542_ET = Date.parse("2026-08-09T19:42:00Z");
const WED_1418_ET = Date.parse("2026-08-05T18:18:00Z");

const conv = (id: string, title: string, updatedAt: number) => ({ id, title, updatedAt });

test("groups by ET trading day, newest day first", () => {
  const groups = groupConversationsByDay(
    [
      conv("a", "SPX Morning Analysis", MON_1032_ET),
      conv("b", "Closing Flow Review", SUN_1542_ET),
      conv("c", "NVDA Flow Investigation", MON_0948_ET),
      conv("d", "META Night Hawk", WED_1418_ET),
    ],
    MON_1032_ET
  );
  assert.deepEqual(groups.map((g) => g.label), ["TODAY", "YESTERDAY", "WED 5 AUG"]);
  assert.equal(groups[0]!.items.length, 2);
});

test("items within a day are newest first and stamped with an ET clock", () => {
  const groups = groupConversationsByDay(
    [conv("c", "NVDA", MON_0948_ET), conv("a", "SPX", MON_1032_ET)],
    MON_1032_ET
  );
  assert.deepEqual(groups[0]!.items.map((i) => i.time), ["10:32", "09:48"]);
});

test("times are ET, not the viewer's local zone", () => {
  // The whole point: a member in London must see the market open, not their afternoon.
  assert.equal(etClock(MON_0948_ET), "09:48");
  assert.equal(etDayKey(MON_0948_ET), "2026-08-10");
});

test("a late-evening ET session stays on its own trading day", () => {
  // 2026-08-11T01:30Z is 21:30 ET on the 10th — UTC has rolled over, ET has not. Grouping on UTC
  // would file an after-hours session under the next day.
  const lateEt = Date.parse("2026-08-11T01:30:00Z");
  assert.equal(etDayKey(lateEt), "2026-08-10");
  assert.equal(etClock(lateEt), "21:30");
});

test("a malformed row never creates a NaN header", () => {
  const groups = groupConversationsByDay(
    [conv("bad", "broken", Number.NaN), conv("a", "SPX", MON_1032_ET)],
    MON_1032_ET
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.items.length, 1);
});

test("empty history yields no groups rather than an empty TODAY header", () => {
  assert.deepEqual(groupConversationsByDay([], MON_1032_ET), []);
});

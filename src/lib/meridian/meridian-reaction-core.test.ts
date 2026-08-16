import { test } from "node:test";
import assert from "node:assert/strict";
import { reactionForYmd, indexBarsByYmd } from "./meridian-reaction-core";

test("reactionForYmd: session and next-day pct from daily bars", () => {
  const bars = [
    { t: Date.parse("2026-07-10T13:30:00Z"), o: 100, h: 101, l: 99, c: 102 },
    { t: Date.parse("2026-07-11T13:30:00Z"), o: 102, h: 104, l: 101, c: 103 },
  ];
  const byYmd = indexBarsByYmd(bars);
  const ordered = [...byYmd.keys()].sort();
  const target = ordered[0]!;
  const rx = reactionForYmd(byYmd, ordered, target);
  assert.equal(rx.session_change_pct, 2);
  assert.equal(rx.next_day_change_pct, 0.98);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSwingActivePlays } from "./live-marks-active.ts";
import type { ActiveZeroDtePlay } from "@/lib/zerodte/live-marks";

const play = (occ: string, ticker: string): ActiveZeroDtePlay => ({
  session_date: "2026-09-04",
  ticker,
  direction: "long",
  strike: 100,
  occ,
  entry_premium: 2,
  status: "OPEN",
  peak_premium: null,
  trough_premium: null,
});

test("mergeSwingActivePlays: 0DTE entered rows win cap priority, then swing OCCs", () => {
  const merged = mergeSwingActivePlays([play("O:AAA", "AAA")], [play("O:BBB", "BBB")], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.ticker, "AAA");
  assert.equal(merged[1]!.ticker, "BBB");
});

test("mergeSwingActivePlays: dedupes duplicate OCCs", () => {
  const merged = mergeSwingActivePlays([play("O:AAA", "AAA")], [play("O:AAA", "AAA")], 3);
  assert.equal(merged.length, 1);
});

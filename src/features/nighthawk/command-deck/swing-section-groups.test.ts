import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSwingSections, SWING_SECTION_LABELS } from "./swing-section-groups.ts";
import type { TerminalPlay } from "./types.ts";

function play(over: Partial<TerminalPlay> & { id: string }): TerminalPlay {
  return {
    ticker: "NVDA", direction: "LONG", contract: "150C", score: 80, status: "WATCH", horizon: "SWING",
    exitModel: "PLAN", factors: [], gates: [], recommendation: "HOLD",
    ...over,
  } as TerminalPlay;
}

test("groupSwingSections: only non-empty sections are returned, in canonical order", () => {
  const groups = groupSwingSections([
    play({ id: "1", servingSection: "WATCH" }),
    play({ id: "2", servingSection: "COMMIT_NOW" }),
    play({ id: "3", servingSection: "EXITING" }),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["COMMIT_NOW", "WATCH", "EXITING"]);
  assert.equal(groups.find((g) => g.key === "COMMIT_NOW")!.plays[0]!.id, "2");
});

test("groupSwingSections: preserves each play's relative order within its section", () => {
  const groups = groupSwingSections([
    play({ id: "a", servingSection: "WATCH", ticker: "AAA" }),
    play({ id: "b", servingSection: "WATCH", ticker: "BBB" }),
    play({ id: "c", servingSection: "WATCH", ticker: "CCC" }),
  ]);
  assert.deepEqual(groups[0]!.plays.map((p) => p.id), ["a", "b", "c"]);
});

test("groupSwingSections: a play with no servingSection lands in the fail-safe UNSECTIONED bucket, never dropped", () => {
  const groups = groupSwingSections([play({ id: "1", servingSection: null })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.key, "UNSECTIONED");
  assert.equal(groups[0]!.plays.length, 1);
});

test("groupSwingSections: empty input → empty groups", () => {
  assert.deepEqual(groupSwingSections([]), []);
});

test("SWING_SECTION_LABELS covers every group key with a distinct, non-empty label", () => {
  const labels = Object.values(SWING_SECTION_LABELS);
  assert.equal(new Set(labels).size, labels.length, "labels must be distinct");
  for (const l of labels) assert.ok(l.length > 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import { filterLevelsCoveredByLadder, LADDER_COVERED_LEVEL_LABELS } from "./level-dedup";

function level(label: string, price = 100): BieLevel {
  return { label, price };
}

test("filterLevelsCoveredByLadder: passes levels through UNCHANGED when hasLadder is false", () => {
  const levels = [level("call wall"), level("spot"), level("confluence (flip+wall)")];
  assert.deepEqual(filterLevelsCoveredByLadder(levels, false), levels);
});

test("filterLevelsCoveredByLadder: drops every single-instance label the Structure Ladder itself renders when a ladder IS present", () => {
  const levels = [
    level("call wall"),
    level("put wall"),
    level("gamma flip"),
    level("max pain"),
    level("GEX king"), // real production casing — must match case-insensitively
    level("gamma magnet"),
  ];
  assert.deepEqual(filterLevelsCoveredByLadder(levels, true), []);
});

test("filterLevelsCoveredByLadder: keeps rows the ladder does NOT carry (spot, confluence) even when a ladder is present", () => {
  const levels = [level("spot"), level("confluence (flip+wall)"), level("call wall")];
  const kept = filterLevelsCoveredByLadder(levels, true);
  assert.deepEqual(
    kept!.map((l) => l.label),
    ["spot", "confluence (flip+wall)"],
    "only the ladder-covered row is dropped — spot/confluence are information the ladder never carries",
  );
});

test("filterLevelsCoveredByLadder: does NOT drop \"dark pool\" rows — the ladder caps dark pool to 3, the table doesn't, so a label-only filter would silently drop real prints beyond the ladder's cap rather than just de-duplicating", () => {
  const levels = [level("dark pool", 100), level("dark pool", 101), level("dark pool", 102), level("dark pool", 103)];
  assert.deepEqual(filterLevelsCoveredByLadder(levels, true), levels);
});

test("filterLevelsCoveredByLadder: undefined levels stay undefined regardless of hasLadder", () => {
  assert.equal(filterLevelsCoveredByLadder(undefined, true), undefined);
  assert.equal(filterLevelsCoveredByLadder(undefined, false), undefined);
});

test("LADDER_COVERED_LEVEL_LABELS: exactly the 6 single-instance kinds — dark pool deliberately excluded (see module header)", () => {
  assert.deepEqual(
    [...LADDER_COVERED_LEVEL_LABELS].sort(),
    ["call wall", "gamma flip", "gamma magnet", "gex king", "max pain", "put wall"].sort(),
  );
});

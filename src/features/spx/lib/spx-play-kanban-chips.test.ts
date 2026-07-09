import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayKanbanChips } from "./spx-play-kanban-chips";
import type { SpxPlayPayload } from "./spx-play-engine";

const basePlay = {
  available: true,
  phase: "OPEN",
  action: "BUY",
  direction: "long",
  grade: "A",
  score: 12,
  confidence: 80,
  headline: "Test",
  thesis: "Test thesis",
  levels: { entry: 7550, stop: 7540, target: 7565, invalidation: "" },
  option_ticket: { contract_label: "7550C", premium_range: "4-6", delta: 0.35 },
} as SpxPlayPayload;

test("buildPlayKanbanChips: structure open uses contract label in open column", () => {
  const cols = buildPlayKanbanChips({
    play: basePlay,
    lotto: null,
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: true,
    structureWatch: false,
  });
  assert.equal(cols.open.length, 1);
  assert.equal(cols.open[0]?.label, "7550C");
  assert.equal(cols.open[0]?.kind, "structure");
});

test("buildPlayKanbanChips: watch column when structure armed", () => {
  const cols = buildPlayKanbanChips({
    play: { ...basePlay, action: "WATCHING", phase: "WATCHING", watch: { active: true, promote_ready: false, reason: "x", since: null } },
    lotto: null,
    powerHour: null,
    history: [],
    filter: "all",
    structureOpen: false,
    structureWatch: true,
  });
  assert.equal(cols.watch.length, 1);
  assert.match(cols.watch[0]?.label ?? "", /7550C|W7550/);
});

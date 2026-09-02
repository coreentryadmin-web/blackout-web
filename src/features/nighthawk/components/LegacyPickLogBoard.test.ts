import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("LegacyPickLogBoard: X Ads shell — table, toolbar, detail rail (Vector parity)", () => {
  const board = readFileSync(new URL("./LegacyPickLogBoard.tsx", import.meta.url), "utf8");
  const columns = readFileSync(new URL("../lib/legacy-board-columns.tsx", import.meta.url), "utf8");
  const rail = readFileSync(new URL("./LegacyPlayDetailRail.tsx", import.meta.url), "utf8");

  assert.match(board, /vector-board-shell legacy-board-shell/, "must use Vector viewport-locked shell");
  assert.match(board, /VectorBoardToolbar/, "must use X Ads-style toolbar");
  assert.match(board, /<colgroup>/, "table must pin column widths via colgroup");
  assert.match(board, /LegacyPlayDetailRail/, "row click must open right-rail inspector");
  assert.doesNotMatch(board, /CommandDeck/, "Legacy must not render card-based CommandDeck");
  assert.doesNotMatch(board, /PlayLifecycleCard/, "Legacy must not render card rows");
  assert.match(columns, /Premium vs entry/, "table must expose premium vs entry column");
  assert.match(columns, /VectorBoardMeter/, "table must render premium path meters");
  assert.match(rail, /LegacyPlayDetailPanel/, "detail rail must embed Legacy play breakdown");
});

test("LegacyDeck wires LegacyPickLogBoard instead of CommandDeck", () => {
  const containers = readFileSync(
    new URL("../command-deck/containers.tsx", import.meta.url),
    "utf8"
  );
  assert.match(containers, /LegacyPickLogBoard/, "LegacyDeck must mount X Ads table board");
  assert.doesNotMatch(
    containers,
    /LegacyDeck[\s\S]*CommandDeck/,
    "LegacyDeck must not mount CommandDeck card list"
  );
});

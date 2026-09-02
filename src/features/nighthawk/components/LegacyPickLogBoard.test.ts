import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("LegacyPickLogBoard: dual-rail inspector — table, manage rail, technicals rail", () => {
  const board = readFileSync(new URL("./LegacyPickLogBoard.tsx", import.meta.url), "utf8");
  const columns = readFileSync(new URL("../lib/legacy-board-columns.tsx", import.meta.url), "utf8");
  const manage = readFileSync(new URL("./LegacyPlayManageRail.tsx", import.meta.url), "utf8");
  const technicals = readFileSync(new URL("./LegacyPlayTechnicalsRail.tsx", import.meta.url), "utf8");
  const dataTable = readFileSync(new URL("./VectorBoardDataTable.tsx", import.meta.url), "utf8");

  assert.match(board, /vector-board-shell legacy-board-shell/, "must use Vector viewport-locked shell");
  assert.match(board, /data-board="legacy-xads-table"/, "legacy shell must expose xads table marker");
  assert.match(board, /legacy-board-shell--inspector/, "inspector mode when row selected");
  assert.match(board, /legacy-board-body--inspector/, "viewport-locked dual-rail body");
  assert.match(board, /LegacyPlayManageRail/, "right rail = trade management");
  assert.match(board, /LegacyPlayTechnicalsRail/, "bottom rail = pick reasoning / technicals");
  assert.match(board, /VectorBoardDataTable/, "must use shared data table with computed column widths");
  assert.doesNotMatch(board, /CommandDeck/, "Legacy must not render card-based CommandDeck");
  assert.match(manage, /Trade plan/, "manage rail shows trade management sections");
  assert.match(technicals, /Why we picked it/, "technicals rail shows pick reasoning");
  assert.match(technicals, /Scoring factors/, "technicals rail shows factor breakdown");
  assert.match(columns, /Premium vs entry/, "table must expose premium vs entry column");
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("VectorPickLogBoard: uses viewport-locked shell with internal table scrollport", () => {
  const src = readFileSync(new URL("./VectorPickLogBoard.tsx", import.meta.url), "utf8");
  const dataTable = readFileSync(new URL("./VectorBoardDataTable.tsx", import.meta.url), "utf8");
  assert.match(src, /vector-board-shell/, "board must use dedicated shell for nh-v2 viewport lock");
  assert.match(dataTable, /vector-board-tablewrap/, "table must scroll internally, not the page");
  assert.doesNotMatch(
    src,
    /nh-deck-rows flex min-h-0 flex-1 flex-col/,
    "flex-col on nh-deck-rows collapses Panel rows under 100svh shell"
  );
});

test("VectorPickLogBoard: X Ads toolbar, premium column, meters, and detail rail", () => {
  const board = readFileSync(new URL("./VectorPickLogBoard.tsx", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("./VectorBoardToolbar.tsx", import.meta.url), "utf8");
  const columns = readFileSync(new URL("../lib/vector-board-columns.tsx", import.meta.url), "utf8");
  assert.match(board, /VectorBoardToolbar/, "board must use dedicated X Ads-style toolbar");
  assert.match(columns, /Premium vs entry/, "table must expose premium vs entry column");
  assert.match(columns, /VectorBoardMeter/, "table must render X Ads-style premium path meters");
  const dataTable = readFileSync(new URL("./VectorBoardDataTable.tsx", import.meta.url), "utf8");
  assert.match(dataTable, /<colgroup>/, "table must pin column widths via colgroup for header/body alignment");
  assert.match(dataTable, /computeBoardColumnWidths/, "colgroup widths must be computed per visible columns");
  assert.match(board, /VectorPlayDetailPanel/, "row click must open right-rail inspector");
  const detail = readFileSync(new URL("./VectorPlayDetailPanel.tsx", import.meta.url), "utf8");
  assert.match(detail, /VectorBoardDetailTabs/, "detail rail must use tabbed inspector");
  assert.doesNotMatch(board, /vector-board-summary-row/, "summary row removed — analytics live in detail rail");
  assert.match(columns, /formatPremiumPct/, "premium % must render prominently");
  assert.match(toolbar, /VectorBoardDatePresetDropdown/, "toolbar must use X Ads date preset dropdown");
  assert.match(toolbar, /VectorBoardFiltersDrawer/, "filters must use drawer pattern");
  assert.match(toolbar, /"Open"/, "tabs use Open/Closed desk language");
  assert.match(board, /VectorBoardScorecard/, "session scorecard mounted for today analytics");
  assert.match(board, /VectorBoardDataTable/, "board uses shared data table component");
  assert.match(board, /VectorBoardLoadingSkeleton/, "board uses shaped loading skeleton");
});

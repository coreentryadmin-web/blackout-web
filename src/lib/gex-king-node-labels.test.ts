import assert from "node:assert/strict";
import { test } from "node:test";
import * as gexKingNodeLabels from "./gex-king-node-labels.ts";
import {
  GEX_KING_DUAL_LABEL,
  gexKingDualLabel,
} from "./gex-king-node-labels.ts";

test("module exports only labels with real consumers — no unused scaffolding re-added", () => {
  // `GEX_ANCHOR_LABEL` ("GEX anchor") was removed 2026-10-31: defined since the initial
  // migration commit (a05cf3245) with zero importers ever (confirmed via
  // `git log -S"GEX_ANCHOR_LABEL"` and a repo-wide grep). Its only live use was already
  // folded into `GEX_KING_DUAL_LABEL`/`gexKingDualLabel` ("King node · GEX anchor"), which
  // both Thermal (`GexHeatmap.tsx`) and SPX (`SpxGexMatrixHeatmap.tsx`) actually import.
  // This locks the exported surface down so a future edit can't silently resurrect an
  // unused standalone export without a deliberate, reviewed change to this test.
  assert.deepEqual(
    Object.keys(gexKingNodeLabels).sort(),
    [
      "GEX_KING_COMPACT_LABEL",
      "GEX_KING_DUAL_LABEL",
      "GEX_KING_NODE_HELP",
      "GEX_KING_NODE_LABEL",
      "gexKingDualLabel",
    ].sort(),
  );
});

test("gexKingDualLabel: no scope returns full dual label", () => {
  assert.equal(gexKingDualLabel(), GEX_KING_DUAL_LABEL);
});

test("gexKingDualLabel: scope suffix for near-term vs 0DTE views", () => {
  assert.equal(gexKingDualLabel("near-term"), `${GEX_KING_DUAL_LABEL} (near-term)`);
  assert.equal(gexKingDualLabel("0DTE"), `${GEX_KING_DUAL_LABEL} (0DTE)`);
});

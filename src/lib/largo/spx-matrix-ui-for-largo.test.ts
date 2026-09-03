import assert from "node:assert/strict";
import { test } from "node:test";
import { SPX_DESK_FOCUS_STORAGE_KEY } from "@/features/spx/lib/spx-desk-focus";
import {
  SPX_IOS_PANEL_STORAGE_KEY,
  spxMatrixUiStateForLargo,
  spxMatrixVexAvailable,
} from "@/lib/largo/spx-matrix-ui-for-largo";

test("spxMatrixVexAvailable requires non-empty vex cells", () => {
  assert.equal(spxMatrixVexAvailable(null), false);
  assert.equal(spxMatrixVexAvailable({ vex: { cells: {} } }), false);
  assert.equal(spxMatrixVexAvailable({ vex: { cells: { "5900:2026-09-05": 1 } } }), true);
});

test("spxMatrixUiStateForLargo documents client-only lens with gex default", () => {
  const state = spxMatrixUiStateForLargo({ vex: { cells: { a: 1 } } });
  assert.equal(state.default_lens, "gex");
  assert.deepEqual(state.available_lenses, ["gex", "vex"]);
  assert.equal(state.active_lens_readable, false);
  assert.match(state.largo_guidance, /get_gex_heatmap/);
  assert.equal(state.client_only_ui.focus_mode, `localStorage key ${SPX_DESK_FOCUS_STORAGE_KEY} (F key / Esc)`);
  assert.equal(state.client_only_ui.ios_panel, `sessionStorage key ${SPX_IOS_PANEL_STORAGE_KEY}`);
});

test("spxMatrixUiStateForLargo omits vex lens when data missing", () => {
  const state = spxMatrixUiStateForLargo({ vex: { cells: {} } });
  assert.deepEqual(state.available_lenses, ["gex"]);
  assert.equal(state.vex_data_present, false);
});

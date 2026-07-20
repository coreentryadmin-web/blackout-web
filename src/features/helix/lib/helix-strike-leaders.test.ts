import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatHitsInWindow,
  HELIX_STRIKE_HITS_WINDOW_MIN,
} from "./helix-strike-leaders";

test("formatHitsInWindow pluralizes hits", () => {
  assert.equal(formatHitsInWindow(1), `1 hit in last ${HELIX_STRIKE_HITS_WINDOW_MIN} min`);
  assert.equal(formatHitsInWindow(3), `3 hits in last ${HELIX_STRIKE_HITS_WINDOW_MIN} min`);
});

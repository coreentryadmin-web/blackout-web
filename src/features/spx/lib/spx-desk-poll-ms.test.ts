import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The matrix-poll comment used to claim the server GEX matrix cache TTL was "5-8s". It has been a
 * flat 5s for every ticker (including SPX) since GEX_HEATMAP_CACHE_SEC dropped to 5 — see
 * polygon-options-gex.ts's own "every ticker is served on a 5s TTL" note — but the comment here
 * was never updated, so it kept quoting a range that hadn't been true for a while (flagged, not
 * fixed, in #3384's PR description). This guards against the same drift recurring.
 */
test("the matrix-poll comment does not re-claim a stale 5-8s server TTL range", () => {
  const src = readFileSync(join(__dirname, "spx-desk-poll-ms.ts"), "utf8");
  assert.match(src, /SPX_MATRIX_POLL_RTH_MS/);
  assert.doesNotMatch(src, /5[–-]8s/, "the server matrix cache TTL is a flat 5s, not a 5-8s range");
});

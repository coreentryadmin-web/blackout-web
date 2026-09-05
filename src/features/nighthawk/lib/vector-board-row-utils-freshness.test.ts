import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "vector-board-row-utils.ts"),
  "utf8"
);

test("vector-board-row-utils: live badge uses isWsUpdatedAtFresh (source scan)", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(ts, LIVE_MS, now\)/);
  assert.doesNotMatch(src, /now - ts <= LIVE_MS/);
});

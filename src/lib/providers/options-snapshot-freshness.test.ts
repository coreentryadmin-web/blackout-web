import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/options-snapshot.ts", "utf8");

test("options-snapshot: getOptionSnapshot cache rejects future ts stamps", () => {
  assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(src, /isWsUpdatedAtFresh\(local\.ts, SNAP_FRESH_MS, now\)/);
  assert.match(src, /isWsUpdatedAtFresh\(hit\.ts, SNAP_FRESH_MS, now\)/);
  assert.doesNotMatch(src, /now - local\.ts <= SNAP_FRESH_MS/);
  assert.doesNotMatch(src, /now - hit\.ts <= SNAP_FRESH_MS/);
});

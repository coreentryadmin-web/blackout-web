import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "flow-data-freshness.ts"),
  "utf8"
);

test("flow-data-freshness: age helpers reject far-future stamps (source scan)", () => {
  assert.match(src, /WS_TIMESTAMP_FUTURE_TOLERANCE_MS/);
  assert.match(src, /flowAgeMsFromStamp/);
  assert.doesNotMatch(src, /Math\.max\(0, now - newest\)/);
  assert.doesNotMatch(src, /Math\.max\(0, now - lastFlowDataAt\)/);
});

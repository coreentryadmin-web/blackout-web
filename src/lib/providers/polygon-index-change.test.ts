import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/polygon.ts", "utf8");

test("fetchIndexSnapshots: omits fabricated 0% when session change_percent is absent", () => {
  assert.match(src, /sessionChg != null && Number\.isFinite\(Number\(sessionChg\)\)/);
  assert.doesNotMatch(
    src,
    /row\.session\?\.change_percent \?\? 0/,
    "must not default missing index session change to 0"
  );
});

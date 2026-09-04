import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/polygon.ts", "utf8");

test("polygon stock snapshots: omits fabricated 0% when change cannot be grounded", () => {
  assert.match(src, /function _changePctFromSnapshotRow/);
  assert.match(src, /return null;/);
  assert.doesNotMatch(
    src,
    /_rowToSnapshot[\s\S]{0,800}: 0;/,
    "_rowToSnapshot must not default missing change_pct to 0"
  );
  assert.doesNotMatch(src, /todaysChangePerc \?\? 0/);
  assert.doesNotMatch(src, /snap\?\.todaysChangePerc \?\? 0/);
});

test("fetchMarketMovers: does not fabricate flat 0% on missing session change", () => {
  assert.doesNotMatch(
    src,
    /change_pct: Number\(\(t\.todaysChangePerc \?\? 0\)\.toFixed\(2\)\)/,
    "mapMover must not default missing todaysChangePerc to 0"
  );
});

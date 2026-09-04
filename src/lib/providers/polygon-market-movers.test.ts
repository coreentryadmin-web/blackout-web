/**
 * Regression: fetchMarketMovers must not fabricate flat 0% when Polygon omits todaysChangePerc.
 * A missing field is unknown — not "unchanged on the day" (2026-09-04).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/providers/polygon.ts", "utf8");

test("fetchMarketMovers: change_pct stays null when todaysChangePerc is absent", () => {
  const start = src.indexOf("export async function fetchMarketMovers");
  assert.ok(start > 0, "fetchMarketMovers exists");
  const end = src.indexOf("type IndexResult", start);
  const block = src.slice(start, end);
  assert.doesNotMatch(
    block,
    /todaysChangePerc \?\? 0/,
    "must not default missing Polygon change to fabricated 0%"
  );
  assert.match(
    block,
    /raw != null && Number\.isFinite\(Number\(raw\)\)/,
    "must gate change_pct on a finite todaysChangePerc"
  );
  assert.match(block, /: null;/, "must emit null when change is unknown");
});

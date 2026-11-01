import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findCountableEmpties } from "../../../scripts/audit/lib/absence-scan.mjs";

/**
 * Regression guard for three sites the 2026-08-21 `largo-absence-scan.mjs` finding named as
 * still OPEN (docs/audit/FINDINGS.md, "'No data' and 'the data is zero' in one payload" —
 * `upcoming_7d: []` / `signals: []` / `items: []` sitting beside `available: false`). Each
 * returned a countable empty on a FAILED read, which a model reads as a measured quiet result
 * rather than "we could not look". Fixed by nulling the countable field in each catch/failure
 * branch — this pins the fix by re-running the same scanner logic used to find them, and by
 * asserting the exact broken substrings are gone.
 */

test("meridian-for-largo.ts's failed-read branch carries no countable empty", () => {
  const src = readFileSync(join(__dirname, "meridian-for-largo.ts"), "utf8");
  assert.deepEqual(findCountableEmpties(src), []);
  assert.match(src, /available: false, upcoming_7d: null, stats: null/);
});

test("product-reads.ts's vectorPulseForLargo failure branches null out signals, not []", () => {
  const src = readFileSync(join(__dirname, "product-reads.ts"), "utf8");
  assert.doesNotMatch(src, /reason: "no_live_vector_state".*signals: \[\]/);
  assert.doesNotMatch(src, /available: false,\s*signals: \[\],/);
  assert.match(src, /reason: "no_live_vector_state", ticker: ticker\.toUpperCase\(\), signals: null/);
  assert.match(src, /available: false,\s*signals: null,/);
});

test("run-tool.ts's get_meridian_timeline unavailable branch nulls items, not []", () => {
  const src = readFileSync(join(__dirname, "run-tool.ts"), "utf8");
  assert.doesNotMatch(src, /error: "timeline_unavailable"[\s\S]{0,300}items: \[\]/);
  assert.match(src, /error: "timeline_unavailable"[\s\S]{0,300}items: null/);
});

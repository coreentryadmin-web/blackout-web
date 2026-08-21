import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";
import {
  LARGO_RESULT_CHAR_BUDGET,
  fitRowsToBudget,
  sampleNote,
} from "@/lib/largo/fit-tool-result";

// The whole point of the module: the budget must stay strictly under the transport's
// own cap. If someone raises the budget to the cap, the tail cut returns and the
// aggregates start falling off the end again — the exact defect this replaced.
test("budget leaves headroom under the transport cap", () => {
  assert.ok(
    LARGO_RESULT_CHAR_BUDGET < MAX_TOOL_RESULT_CHARS,
    `budget ${LARGO_RESULT_CHAR_BUDGET} must be < transport cap ${MAX_TOOL_RESULT_CHARS}`
  );
});

test("fitRowsToBudget keeps the assembled WHOLE inside the budget, not just the rows", () => {
  const base = { win_rate_pct: 41.8, note: "x".repeat(500) };
  const rows = Array.from({ length: 400 }, (_, i) => ({ ticker: `T${i}`, pnl: i, pad: "y".repeat(60) }));
  const { kept, total, chars } = fitRowsToBudget(base, "plays", rows, { budget: 4000 });
  assert.equal(total, 400);
  assert.ok(kept.length > 0, "should keep at least some rows");
  assert.ok(kept.length < 400, "should not keep all rows at this budget");
  assert.ok(chars <= 4000, `assembled ${chars} must be <= 4000`);
  // Measured on the real assembled object — re-serializing must agree.
  assert.equal(JSON.stringify({ ...base, plays: kept }).length, chars);
});

test("fitRowsToBudget honours maxRows even when the budget would allow more", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ i }));
  const { kept, total } = fitRowsToBudget({}, "plays", rows, { budget: 100_000, maxRows: 7 });
  assert.equal(kept.length, 7);
  assert.equal(total, 100, "total must report the FULL count, never the kept count");
});

test("fitRowsToBudget keeps rows in the order supplied (newest-first is the caller's call)", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const { kept } = fitRowsToBudget({}, "plays", rows, { budget: 100_000 });
  assert.deepEqual(kept.map((r) => r.id), ["a", "b", "c"]);
});

test("an oversized base returns zero rows rather than silently dropping the base", () => {
  const base = { blob: "z".repeat(5000) };
  const { kept, chars } = fitRowsToBudget(base, "plays", [{ a: 1 }], { budget: 100 });
  assert.equal(kept.length, 0);
  assert.ok(chars > 100, "caller must be able to SEE that the base itself overflows");
});

// A silently shortened list is the same class of defect as a truncated one: the model
// cannot tell a sample from the universe, so it reports the sample size as the total.
test("sampleNote states the sample size, the true total, and that aggregates cover all", () => {
  const note = sampleNote(25, 182, "committed 0DTE plays");
  assert.match(note, /25/);
  assert.match(note, /182/);
  assert.match(note, /SAMPLE/i);
  assert.match(note, /aggregate/i);
});

test("sampleNote does not claim a sample when the whole list is present", () => {
  const note = sampleNote(7, 7, "committed 0DTE plays");
  assert.match(note, /All 7/);
  assert.doesNotMatch(note, /SAMPLE/i);
});

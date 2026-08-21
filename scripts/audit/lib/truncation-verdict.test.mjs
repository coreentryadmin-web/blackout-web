import assert from "node:assert/strict";
import test from "node:test";

import { parseProbeReply, probeQuestion, summarizeRun } from "./truncation-verdict.mjs";

test("reads a clean TRUNCATED reply and its corroborating last key", () => {
  const r = parseProbeReply("TRUNCATED\n\nThe last top-level key I can actually see is `analytics`.");
  assert.equal(r.verdict, "TRUNCATED");
  assert.equal(r.last_key, "analytics");
});

test("reads a clean COMPLETE reply", () => {
  const r = parseProbeReply("COMPLETE\n\nLast top-level key: `plays`");
  assert.equal(r.verdict, "COMPLETE");
  assert.equal(r.last_key, "plays");
});

// The two readings invert the finding, so a reply carrying both words is not guessed at.
test("a reply containing BOTH words is INDETERMINATE, never guessed", () => {
  assert.equal(parseProbeReply("It is not TRUNCATED, the result is COMPLETE").verdict, "INDETERMINATE");
});

test("an unparseable reply is INDETERMINATE, never COMPLETE", () => {
  for (const bad of ["", "I'm not sure what you mean.", null, undefined, 42]) {
    assert.equal(parseProbeReply(bad).verdict, "INDETERMINATE", `should be indeterminate for ${String(bad)}`);
  }
});

test("a missing last key downgrades nothing — it is corroboration, not the verdict", () => {
  const r = parseProbeReply("TRUNCATED");
  assert.equal(r.verdict, "TRUNCATED");
  assert.equal(r.last_key, null);
});

// ── The rule this module exists for ────────────────────────────────────────────────
// A run of all-COMPLETE is indistinguishable from a run that never reached the model.
test("without a proven control, COMPLETE is UNVERIFIED — never reported clean", () => {
  const rows = [
    { tool: "a", verdict: "COMPLETE" },
    { tool: "b", verdict: "COMPLETE" },
  ];
  const s = summarizeRun(rows, "COMPLETE"); // control did NOT truncate → instrument unproven
  assert.equal(s.control_proven, false);
  assert.deepEqual(s.clean, []);
  assert.deepEqual(s.unverified, ["a", "b"]);
  assert.equal(s.ok, false, "an unproven run must not exit clean");
});

test("with a proven control, COMPLETE is genuinely clean", () => {
  const s = summarizeRun([{ tool: "a", verdict: "COMPLETE" }], "TRUNCATED");
  assert.equal(s.control_proven, true);
  assert.deepEqual(s.clean, ["a"]);
  assert.deepEqual(s.unverified, []);
  assert.equal(s.ok, true);
});

test("any truncation fails the run even when the control proved out", () => {
  const s = summarizeRun(
    [{ tool: "a", verdict: "COMPLETE" }, { tool: "b", verdict: "TRUNCATED" }],
    "TRUNCATED"
  );
  assert.deepEqual(s.truncated, ["b"]);
  assert.equal(s.ok, false);
});

test("an INDETERMINATE tool fails the run rather than being quietly dropped", () => {
  const s = summarizeRun([{ tool: "a", verdict: "INDETERMINATE" }], "TRUNCATED");
  assert.deepEqual(s.indeterminate, ["a"]);
  assert.equal(s.ok, false, "an unknown is not a pass");
});

test("the question names the marker and demands a one-word verdict", () => {
  const q = probeQuestion("get_zerodte_record", "days=30");
  assert.match(q, /…\[truncated\]/);
  assert.match(q, /TRUNCATED or COMPLETE/);
  assert.match(q, /get_zerodte_record with days=30/);
  assert.match(q, /LAST\s+top-level key/);
});

test("the question works for a tool with no args", () => {
  assert.match(probeQuestion("get_open_plays"), /Call get_open_plays and nothing else/);
});

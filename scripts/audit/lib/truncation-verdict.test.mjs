import assert from "node:assert/strict";
import test from "node:test";

import { mentionsTool, parseProbeReply, probeQuestion, summarizeRun } from "./truncation-verdict.mjs";

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
  assert.match(q, /rows_truncated/);
  assert.match(q, /does NOT end with …\[truncated\]/);
});

test("the question works for a tool with no args", () => {
  assert.match(probeQuestion("get_open_plays"), /Call get_open_plays and nothing else/);
});

test("mentionsTool matches a whole identifier and not a substring of a longer one", () => {
  assert.equal(mentionsTool('{"name":"get_zerodte_plays"}', "get_zerodte_plays"), true);
  assert.equal(mentionsTool('{"name":"get_zerodte_plays_v2"}', "get_zerodte_plays"), false);
  assert.equal(mentionsTool("called get_open_plays, then stopped", "get_open_plays"), true);
  assert.equal(mentionsTool("nothing here", "get_open_plays"), false);
});

test("mentionsTool treats a name with regex metacharacters as a literal, never a pattern", () => {
  // The bug this replaced compiled the name into a RegExp, so `.` matched any character and an
  // unbalanced bracket threw mid-run. A name is a name.
  assert.equal(mentionsTool("get_aXb", "get_a.b"), false);
  assert.equal(mentionsTool("get_a.b", "get_a.b"), true);
  assert.doesNotThrow(() => mentionsTool("anything", "get_a[b"));
});

test("mentionsTool refuses to answer true for an empty or non-string tool", () => {
  assert.equal(mentionsTool("get_x", ""), false);
  assert.equal(mentionsTool("get_x", null), false);
  assert.equal(mentionsTool(null, "get_x"), false);
});

test("an INDETERMINATE says WHICH kind of unknown it is", () => {
  assert.equal(parseProbeReply("not TRUNCATED, it is COMPLETE").reason, "reply claimed BOTH truncated and complete");
  assert.equal(parseProbeReply("").reason, "empty reply");
  assert.equal(parseProbeReply("I cannot answer that.").reason, "reply named neither TRUNCATED nor COMPLETE");
});

test("a decided verdict carries no reason — a reason means an unknown", () => {
  assert.equal(parseProbeReply("TRUNCATED\n`analytics`").reason, null);
  assert.equal(parseProbeReply("COMPLETE\n`plays`").reason, null);
});

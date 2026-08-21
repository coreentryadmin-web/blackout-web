import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";

/**
 * VECTOR PULSE WIRING — a declared tool must actually be reachable.
 *
 * THE BUG THIS PINS. Vector Pulse shipped end to end: the detector (vector-pulse.ts), the panel
 * (VectorPulse.tsx) and a server-side reader (bie/vector-pulse-brief.ts). The reader had exactly
 * one caller — bie/composers.ts, the BIE answer-router — and Largo stopped routing through that
 * router. So from Largo's side Pulse was DARK: asked "what's the Vector pulse on NVDA" it answered
 * from walls and regime and never mentioned that a pulse rail exists.
 *
 * Nothing failed. No test, no error, no log line. The identical shape as the helix-signal-outcomes
 * cron: a fully built feature with no path to the thing that answers questions about it.
 *
 * A declaration in three places that disagree is how that happens, so this asserts all three agree:
 * the tool is DECLARED, DISPATCHABLE, and CATALOGUED. Every one of those is a separate file, and
 * missing any one produces a different silent failure — a tool the model can call and that throws,
 * a tool nothing ranks so the model never reaches for it, or a capability pointing at nothing.
 */

const TOOL = "get_vector_pulse";

test("the pulse tool is DECLARED in the tool defs", () => {
  const def = LARGO_TOOL_DEFS.find((t) => t.name === TOOL);
  assert.ok(def, `${TOOL} missing from LARGO_TOOL_DEFS`);
  assert.match(def!.description, /pulse/i);
  // The differential nature is the whole reason this tool exists alongside get_vector_full_state.
  // If the description stops saying so, the model will treat them as interchangeable.
  assert.match(def!.description, /chang|differential/i);
  // has_baseline is the field that stops "no signals yet" being reported as "the tape is quiet".
  assert.match(def!.description, /has_baseline/);
});

test("the pulse tool is DISPATCHABLE in run-tool", () => {
  // Read as source rather than executing: the dispatcher's imports reach Redis and the provider
  // stack, and the assertion here is purely that the case exists and routes to the real reader.
  const src = readFileSync("src/lib/largo/run-tool.ts", "utf8");
  assert.ok(src.includes(`case "${TOOL}"`), `${TOOL} has no case in run-tool.ts`);
  assert.ok(src.includes("vectorPulseForLargo"), "the case must call the real product read");
});

test("the pulse tool is CATALOGUED as a capability", () => {
  const cap = LARGO_CAPABILITIES.find((c) => c.tool === TOOL);
  assert.ok(cap, `${TOOL} missing from LARGO_CAPABILITIES — nothing would ever rank it`);
  assert.equal(cap!.product, "VECTOR");
  // `snapshot_delta`, and the distinction is load-bearing in BOTH directions.
  //
  // This asserted "windowed" and defended it correctly: an `as_of` capability would be picked for
  // "what is the state" and never for "what just changed", which is the only question this tool
  // can answer. But `windowed` is PAST-CAPABLE, so it also told `plan.ts` that a question about
  // yesterday could be answered from a tool that diffs now against the last cached snapshot.
  //
  // `snapshot_delta` is the class that was missing: `changeCapabilities()` includes it, so pulse
  // still ranks for "what changed"; PAST_CAPABLE does not, so it can no longer clear the
  // historical guard.
  assert.equal(cap!.temporal, "snapshot_delta");
  assert.ok(cap!.keywords.includes("pulse"));
});

test("the reader never reimplements the pulse detector", () => {
  // A parallel implementation would drift the moment detectPulseSignals is tuned, and Largo would
  // then confidently describe a rail that does not match the one members see.
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  assert.ok(src.includes("buildPulseSignalsForState"), "must call the real signal builder");
  assert.ok(src.includes("fetchVectorFullState"), "must read the real Vector state");
  assert.ok(!src.includes("detectPulseSignals("), "must not call the detector directly — go through the real builder");
});

test("every pulse timestamp is shipped on the same at(ms)+at_et(ET) convention, not a raw epoch", () => {
  // THE DEFECT: `VectorWallEvent.time` is epoch SECONDS (vector-pulse.ts multiplies it by 1000 to
  // build a signal's ms `at`), while `signals[].at` and `snapshot.at` are epoch MILLISECONDS. The
  // pulse tool shipped the raw `time` beside the raw `at`, so one payload carried two timestamp
  // families 1000x apart, both unlabelled — a model correlating a wall event with a signal was off
  // by three orders of magnitude, and neither carried an ET/session anchor (contract C1's class).
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  const fn = src.slice(
    src.indexOf("export async function vectorPulseForLargo"),
    src.indexOf("export async function", src.indexOf("export async function vectorPulseForLargo") + 1)
  );
  // Wall events are re-expressed in ms and stamped, and the ambiguous seconds field is gone.
  assert.match(fn, /e\.time \* 1000/, "wall-event seconds must be converted to ms");
  assert.match(fn, /at_et: etStamp\(atMs\)/, "each wall event carries an ET stamp");
  assert.doesNotMatch(
    fn,
    /wall_events: state\.wallEvents\.slice\(-12\),/,
    "the raw wall-event array (seconds `time`, no ET) must not be shipped as-is"
  );
  // Signals and the snapshot both gain the ET sibling.
  assert.match(fn, /at: s\.at,\s*\n\s*at_et: etStamp\(s\.at\)/, "each signal carries at_et beside at");
  assert.match(fn, /\.\.\.current, at_et: etStamp\(current\.at\)/, "the snapshot carries at_et");
});

test("the pulse description states the timestamp convention it now ships", () => {
  const def = LARGO_TOOL_DEFS.find((d) => d.name === "get_vector_pulse");
  assert.ok(def, "get_vector_pulse must be declared");
  assert.match(def.description, /at_et/, "the description must teach the at_et field");
  assert.match(def.description, /MILLISECONDS/, "…and that `at` is epoch ms");
});

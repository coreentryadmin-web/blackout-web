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
  // "windowed", not "as_of": a snapshot capability would be picked for "what is the state" and
  // never for "what just changed", which is the only question this tool can answer.
  assert.equal(cap!.temporal, "windowed");
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

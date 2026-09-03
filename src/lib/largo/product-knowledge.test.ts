import test from "node:test";
import assert from "node:assert/strict";
import { LARGO_PRODUCT_KNOWLEDGE } from "./product-knowledge";
import { LARGO_SYSTEM_PROMPT } from "./system-prompt";

test("product knowledge covers all five core desks", () => {
  const k = LARGO_PRODUCT_KNOWLEDGE;
  assert.match(k, /SPX Slayer/);
  assert.match(k, /HELIX/);
  assert.match(k, /BlackOut Thermal/);
  assert.match(k, /Vector/);
  assert.match(k, /Night Hawk/);
});

test("product knowledge names new HELIX and Thermal tools", () => {
  const k = LARGO_PRODUCT_KNOWLEDGE;
  assert.match(k, /get_flow_brief/);
  assert.match(k, /get_helix_tape_analytics/);
  assert.match(k, /get_thermal_compare/);
  assert.match(k, /get_vector_pulse/);
  assert.match(k, /gex_cross_validation/);
});

test("product knowledge names SPX convergence and journal tools", () => {
  const k = LARGO_PRODUCT_KNOWLEDGE;
  assert.match(k, /get_spx_desk_convergence/);
  assert.match(k, /get_spx_journal/);
  assert.match(k, /get_spx_voice_feed/);
  assert.match(k, /get_playbook_shadow_history/);
  assert.match(k, /get_concept/);
  assert.match(k, /suggested play \+ desk execution/i);
});

test("system prompt embeds full product knowledge block", () => {
  assert.match(LARGO_SYSTEM_PROMPT, /Product knowledge — panels, fields, and tools/);
  assert.match(LARGO_SYSTEM_PROMPT, /get_helix_tape_analytics/);
});

test("system prompt no longer promises PNG card generation", () => {
  assert.doesNotMatch(LARGO_SYSTEM_PROMPT, /shareable BLACKOUT card — a real PNG/);
  assert.match(LARGO_SYSTEM_PROMPT, /does NOT render PNGs/);
});

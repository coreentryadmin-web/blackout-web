import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A correct answer that reads like a debug dump is still a defect.
 *
 * PRODUCTION, 2026-08-20 — measured immediately after the vanna walls were wired into Largo's
 * context (the fix for the fabricated "vanna walls don't appear as discrete strikes" negative):
 *
 *   "The vex_pos_wall sits at 7,900 and vex_neg_wall at 7,625 — those are the strike
 *    concentrations where vanna exposure peaks in each direction."
 *
 * Both numbers are CORRECT. The fix worked. And the sentence is unreadable: a snake_case
 * identifier mid-sentence tells a member they are looking at a payload rather than a desk read.
 * Fixing a data gap re-introduced a language problem one layer up, which is why the shape checks
 * and the correctness checks both have to run — each is blind to the other's failure.
 */

const SYSTEM = readFileSync(join(process.cwd(), "src/lib/largo/system-prompt.ts"), "utf8");

test("REGRESSION: the prompt forbids speaking internal field names", () => {
  assert.match(SYSTEM, /never speak the schema/i, "the rule must be stated in actionable words");
  // The exact observed leak is named, so the rule is anchored to a real case rather than a vibe.
  assert.match(SYSTEM, /vex_pos_wall/, "must name the identifier that actually leaked");
  assert.match(SYSTEM, /positive vanna wall/i, "must give the human phrasing to use instead");
});

test("the rule is mechanical, not a matter of taste", () => {
  // "Write clearly" is unfalsifiable. A token-shape test is something the model can apply.
  assert.match(SYSTEM, /underscore/i);
  assert.match(SYSTEM, /camelCase/);
});

test("it covers the other payload families, not just vanna", () => {
  // A rule written around one example gets applied to one example.
  for (const ident of ["net_gex", "gex_flip", "max_pain_by_expiry"]) {
    assert.ok(SYSTEM.includes(ident), `should name ${ident} as a leak to translate`);
  }
});

test("the honesty rules it sits beside are untouched", () => {
  // This was inserted next to the absence-of-evidence section; it must not have displaced it.
  assert.match(SYSTEM, /Evidence absent is NOT evidence of absence/);
  assert.match(SYSTEM, /silent omission/i);
});

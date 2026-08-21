import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Largo narrated its own plumbing to a member.
 *
 * VERBATIM FROM PROD 2026-08-20, Meridian scope, Concrete depth, "What earnings matter this week?":
 *
 *   "The Meridian prefetch already has the week's event board loaded. Here's what matters: ..."
 *
 * A member does not know what a prefetch is. "Already loaded" says nothing about their earnings —
 * it is a statement about how the answer was assembled, which is not an observation about the
 * market. Same family as #2395 ("the vex_pos_wall sits at 7,900"): internal vocabulary reaching
 * member prose. Field names were fixed; the MACHINERY nouns were not.
 *
 * WHY IT SHIPPED — the rule existed and could not compete. Field names had a full non-negotiable
 * section with worked ✅/❌ pairs. Internal subsystems had ONE bullet inside "### Formatting",
 * sitting between "No markdown tables (pipe syntax)" and "Tickers in CAPS" — a member-honesty rule
 * filed as a typography preference, with no examples. The model had concrete guidance for one and
 * a passing mention for the other.
 *
 * The fix WIDENS the existing non-negotiable section rather than adding a second rule elsewhere —
 * the same shape as #2390, and for the same reason: a non-negotiable split across two places is a
 * rule on its way to being weakened.
 */

const SYSTEM = readFileSync(join(process.cwd(), "src/lib/largo/system-prompt.ts"), "utf8");
const SECTION = SYSTEM.slice(
  SYSTEM.indexOf("## Never speak the schema (non-negotiable)"),
  SYSTEM.indexOf("## ", SYSTEM.indexOf("## Never speak the schema (non-negotiable)") + 10)
);

test("REGRESSION: the exact prod sentence is a worked counter-example", () => {
  // Not paraphrased. The line that shipped is the line the prompt now shows as wrong.
  assert.match(SECTION, /The Meridian prefetch already has the week's event board loaded/);
});

test("the rule names the SHAPE, not just that one sentence", () => {
  // A rule that only forbids the observed sentence is a patch. This has to generalise to the next
  // machinery noun nobody has seen yet.
  assert.match(SECTION, /Never narrate how you got the data/i);
  for (const noun of ["prefetch", "cache", "tool call", "payload", "snapshot"]) {
    assert.ok(SECTION.includes(noun), `must name "${noun}" as plumbing`);
  }
});

test("a MISSING read is still reportable — only the component is hidden", () => {
  // The trap in over-applying this: silence about a failed read is the silent-omission defect the
  // honesty contract exists to prevent. The member must learn VIX is unavailable; they must not
  // learn which fetch threw.
  assert.match(SECTION, /a member DOES need to know a read is missing/i);
  assert.match(SECTION, /say the READ\s+is unavailable, never which component failed/i);
  assert.match(SECTION, /VIX is unavailable right now/);
});

test("the honesty rule is no longer filed under Formatting", () => {
  // It sat between "No markdown tables" and "Tickers in CAPS" — which is why it lost to a section
  // with worked examples. The bullet now points at the real rule instead of half-stating it.
  const fmt = SYSTEM.slice(SYSTEM.indexOf("### Formatting"), SYSTEM.indexOf("## Scope and limitations"));
  assert.doesNotMatch(
    fmt,
    /^- Never name internal subsystems in member-facing text\.$/m,
    "the standalone formatting bullet must be gone"
  );
  assert.match(fmt, /see "Never speak the schema"/, "…and must redirect to the section that owns it");
  assert.match(fmt, /honesty rule, not a\s+formatting preference/i);
});

test("the original field-name guidance survives intact", () => {
  // This is an ADDITION. #2395's examples must not be displaced by the new ones — that would trade
  // one leak for another.
  assert.match(SECTION, /vex_pos_wall/);
  assert.match(SECTION, /Translate every field name into the desk's own language/);
});

test("the rule is not duplicated into a second location", () => {
  // Two copies drift; one wins and the other rots, and nobody knows which the model followed.
  const hits = SYSTEM.match(/Never narrate how you got the data/gi) ?? [];
  assert.equal(hits.length, 1, `appears ${hits.length} times; it must live in exactly one place`);
});

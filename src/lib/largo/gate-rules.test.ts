import { test } from "node:test";
import assert from "node:assert/strict";
import { gateRulesForLargo } from "./gate-rules";
import { mixedTapeBlockThreshold } from "@/features/spx/lib/spx-play-gates";

test("the mixed-tape block is GRADE-SCALED — the fact Largo got wrong", () => {
  // Largo asserted "Cold BUY requires grade A or better AND tape must be clean (not mixed)" and
  // called a grade-A commit a gate violation. The real rule lets an A tolerate MORE conflict than
  // a B, so an A committing while a C was blocked in the same session is correct behaviour.
  const rules = gateRulesForLargo();
  const by = Object.fromEntries(
    rules.mixed_tape_block_threshold.map((r) => [r.grade, r.weighted_conflicts_at_or_above_blocks])
  );
  assert.ok(by.A > by.B, `A (${by.A}) must tolerate more conflict than B (${by.B})`);
  assert.ok(by.B >= by.C, `B (${by.B}) must not block sooner than C (${by.C})`);
});

test("every threshold comes from the REAL function, never a copy", () => {
  // A hard-coded copy would drift the moment someone tunes the engine, and would then report a
  // rule the engine does not enforce — reintroducing exactly the failure this module fixes.
  const rules = gateRulesForLargo();
  for (const row of rules.mixed_tape_block_threshold) {
    assert.equal(row.weighted_conflicts_at_or_above_blocks, mixedTapeBlockThreshold(row.grade));
    assert.equal(row.with_strong_conviction_score_58_plus, mixedTapeBlockThreshold(row.grade, 58));
  }
});

test("the strong-conviction variant is reported, not hidden", () => {
  // |score| >= 58 on a B-or-better setup buys one more tolerated conflict. Omitting it would make
  // a legitimate commit look like a violation to anyone reading only the base number.
  const rules = gateRulesForLargo();
  const b = rules.mixed_tape_block_threshold.find((r) => r.grade === "B")!;
  assert.equal(b.with_strong_conviction_score_58_plus, b.weighted_conflicts_at_or_above_blocks + 1);
});

test("the payload tells the model not to reconstruct rules from rejections", () => {
  // The behavioural fix. Seeing a block message for one candidate is not seeing the rule, and
  // reasoning backwards from outcomes is what produced a confident, wrong root cause for a loss.
  const rules = gateRulesForLargo();
  const text = rules.interpretation.join(" ");
  assert.match(text, /GRADE-SCALED/);
  assert.match(text, /CORRECT behaviour/);
  assert.match(text, /Do not report that as a gate violation/);
  assert.match(text, /does not tell you the rule/);
});

test("it scopes itself to SPX Slayer rather than implying platform-wide authority", () => {
  // 0DTE's confluence-2 commit gate, the Cortex veto and the fail-closed firewall are separate
  // systems. Silence about that invites the numbers here being quoted at the wrong engine.
  assert.match(gateRulesForLargo().interpretation.join(" "), /0DTE Command|Cortex|firewall/);
});

test("the snapshot carries every gate a loss could plausibly be blamed on", () => {
  const r = gateRulesForLargo();
  for (const k of [
    "min_grade_rank",
    "buy_cooldown_sec",
    "cooldown_after_stop_min",
    "gex_stale_max_sec",
    "weighted_conflict_block_base",
  ] as const) {
    assert.equal(typeof r[k], "number", `${k} missing`);
  }
  assert.equal(typeof r.buy_cooldown_a_plus_bypass, "boolean");
  assert.ok(Date.parse(r.as_of) > 0);
});

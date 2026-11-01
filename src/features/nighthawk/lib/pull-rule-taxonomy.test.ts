import test from "node:test";
import assert from "node:assert/strict";
import { classifyPullRules, PULL_RULE_TAGS } from "./pull-rule-taxonomy";

// Every case below uses the EXACT literal sentence computePlayVerdict (morning-confirm-verdict.ts)
// produces for that check, wrapped exactly as morning-verdict-persist.ts's buildMorningVerdictRecord
// wraps it ("Pulled pre-open (gap-away): <reason>" / "Pulled pre-open (severe degradation): <r1>; <r2>")
// -- so a future edit to either file's wording breaks this suite loudly instead of the two silently
// drifting apart.

test("classifyPullRules: null/undefined/empty reason -> empty array, never a guess", () => {
  assert.deepEqual(classifyPullRules(null), []);
  assert.deepEqual(classifyPullRules(undefined), []);
  assert.deepEqual(classifyPullRules(""), []);
});

test("classifyPullRules: unrecognized free text matches nothing rather than a false positive", () => {
  assert.deepEqual(classifyPullRules("some future reason template this module has never seen"), []);
});

test("classifyPullRules: stock stop-through (check 0, hard invalidation)", () => {
  const reason = "Pulled pre-open: NVDA pre-market 118.50 has gapped through the stop (120.00)";
  assert.deepEqual(classifyPullRules(reason), ["stock_stop_through"]);
});

test("classifyPullRules: target consumed pre-market (check 0, degraded)", () => {
  const reason =
    "Pulled pre-open (severe degradation): NVDA pre-market 135.00 already at/through target (130.00) — reward consumed pre-open; 2 active flow anomaly(ies) — elevated uncertainty, reduce size";
  const tags = classifyPullRules(reason);
  assert.ok(tags.includes("target_consumed_premarket"));
  assert.ok(tags.includes("anomaly_catchall"));
});

test("classifyPullRules: SPX gap against direction, hard invalidation wording", () => {
  const reason = "Pulled pre-open: SPX gapped -25.0 pts against LONG direction";
  assert.deepEqual(classifyPullRules(reason), ["spx_gap_against_direction"]);
});

test("classifyPullRules: SPX gap generic catch-all (check 4) is a DISTINCT rule from the against-direction one", () => {
  const reason = "Pulled pre-open (severe degradation): SPX gapped +22.0 pts — verify entry levels, stop may be unsafe; Contrary flow anomaly detected — reduce size";
  const tags = classifyPullRules(reason);
  assert.deepEqual(tags.sort(), ["contrary_anomaly_soft", "spx_gap_generic"].sort());
  assert.ok(!tags.includes("spx_gap_against_direction"), "the generic catch-all wording must not also match the against-direction pattern");
});

test("classifyPullRules: contrary flow anomalies, hard (>=2) vs soft (1) are distinct rules", () => {
  assert.deepEqual(classifyPullRules("Pulled pre-open: 2 contrary flow anomalies detected"), ["contrary_anomalies_hard"]);
  const softTags = classifyPullRules(
    "Pulled pre-open (severe degradation): Contrary flow anomaly detected — reduce size; SPX gapped +21.0 pts — verify entry levels, stop may be unsafe"
  );
  assert.deepEqual(softTags.sort(), ["contrary_anomaly_soft", "spx_gap_generic"].sort());
});

test("classifyPullRules: regime mismatch (hard flip) vs regime choppy (soft) are distinct rules", () => {
  assert.deepEqual(classifyPullRules("Pulled pre-open: Regime flipped to BEARISH — contradicts LONG direction"), ["regime_mismatch_hard"]);
  assert.deepEqual(classifyPullRules("Pulled pre-open: Regime is CHOPPY — choppy/neutral reduces conviction for directional plays"), ["regime_choppy"]);
});

test("classifyPullRules: GEX wall shift (hard, >30pts) vs drift (soft, 10-30pts) are distinct rules", () => {
  assert.deepEqual(classifyPullRules("Pulled pre-open: Put wall shifted 35 pts from edition (5800 → 5765)"), ["gex_wall_shift_hard"]);
  assert.deepEqual(classifyPullRules("Pulled pre-open: Call wall drifted 15 pts (5900 → 5915) — tighten target"), ["gex_wall_drift_soft"]);
});

test("classifyPullRules: single-name-no-data (weak SPX proxy) rule", () => {
  const reason = "Pulled pre-open: NVDA pre-market price unavailable — SPX gap alone cannot confirm a single-name play";
  assert.deepEqual(classifyPullRules(reason), ["single_name_no_data"]);
});

test("classifyPullRules: a real severe-degradation multi-reason pull attributes to EVERY contributing rule, not just one", () => {
  const reason =
    "Pulled pre-open (severe degradation): Regime is CHOPPY — choppy/neutral reduces conviction for directional plays; Put wall drifted 12 pts (5800 → 5788) — tighten stop";
  const tags = classifyPullRules(reason);
  assert.deepEqual(tags.sort(), ["gex_wall_drift_soft", "regime_choppy"].sort());
});

test("PULL_RULE_TAGS: every tag classifyPullRules can return is declared in the exported list", () => {
  const allReasons = [
    "has gapped through the stop",
    "already at/through target",
    "SPX gapped +1 pts against LONG direction",
    "SPX gapped +1 pts — verify entry levels",
    "3 contrary flow anomalies detected",
    "Contrary flow anomaly detected — reduce size",
    "1 active flow anomaly(ies) — elevated uncertainty, reduce size",
    "contradicts SHORT direction",
    "choppy/neutral reduces conviction",
    "Call wall shifted 40 pts from edition",
    "Put wall drifted 15 pts",
    "pre-market price unavailable — SPX gap alone",
  ];
  const seen = new Set(allReasons.flatMap((r) => classifyPullRules(r)));
  for (const tag of seen) assert.ok((PULL_RULE_TAGS as readonly string[]).includes(tag), `${tag} must be declared`);
  assert.equal(seen.size, PULL_RULE_TAGS.length, "every declared tag should be reachable by some real template above");
});

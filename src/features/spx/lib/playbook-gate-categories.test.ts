import test from "node:test";
import assert from "node:assert/strict";
import { classifyGateBlock, categorizeGateBlocks, firstGateBlockCategory } from "./playbook-gate-categories";

test("classifyGateBlock: playbook validity", () => {
  assert.equal(classifyGateBlock("Playbook PB-03 not in live allowlist"), "playbook_validity");
  assert.equal(
    classifyGateBlock("Playbook PB-03 not paper-executable (mode=shadow; allowlist=PB-01)"),
    "playbook_validity"
  );
  assert.equal(classifyGateBlock("Unknown EMA regime — playbook live gate fail-closed"), "playbook_validity");
});

test("classifyGateBlock: operational vs risk", () => {
  assert.equal(classifyGateBlock("Opening range — no BUY until 9:50 AM ET"), "operational");
  assert.equal(classifyGateBlock("Buy cooldown (10m after any exit)"), "risk");
});

test("classifyGateBlock: playbook session trigger cap is a risk block, like its session-cap siblings", () => {
  // trade-governor.ts emits this exact message (line ~153) when a playbook has fired its max
  // allowed triggers for the session — the same kind of session-level risk cap as the two
  // sibling messages below, which already classify as "risk".
  assert.equal(classifyGateBlock("Playbook PB-01 session trigger cap (3)"), "risk");
  assert.equal(
    classifyGateBlock("Session entry cap (3) — stand down for today"),
    "risk"
  );
  assert.equal(
    classifyGateBlock("Session loss cap (2) — revenge-trading lockout"),
    "risk"
  );
});

test("categorizeGateBlocks: buckets all blocks", () => {
  const cats = categorizeGateBlocks([
    "Opening range — no BUY",
    "Buy cooldown",
    "Grade B below minimum",
  ]);
  assert.equal(cats.operational.length, 1);
  assert.equal(cats.risk.length, 1);
  assert.equal(cats.quality.length, 1);
});

test("firstGateBlockCategory: operational before quality", () => {
  assert.equal(
    firstGateBlockCategory(["Opening range — no BUY", "Grade B below minimum"]),
    "operational"
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
// Import the pure core, NOT vector-alert-rules-db.ts: the latter is `import "server-only"`,
// which throws on a plain `tsx --test` import. The core module re-exports the identical runtime
// surface (see its header comment) — same pattern as vector-dte-walls-server.test.ts.
import { rowToAlertRule, sanitizeIncomingRules } from "./vector-alert-rules-core";

test("rowToAlertRule: wall-touch row with a numeric tolerance keeps tolerancePct", () => {
  const rule = rowToAlertRule({
    id: "SPY:wall-touch:1",
    ticker: "SPY",
    kind: "wall-touch",
    tolerance_pct: 0.002,
    enabled: true,
  });
  assert.deepEqual(rule, {
    id: "SPY:wall-touch:1",
    ticker: "SPY",
    kind: "wall-touch",
    enabled: true,
    tolerancePct: 0.002,
  });
});

test("rowToAlertRule: null tolerance_pct (flip-cross row) omits tolerancePct entirely", () => {
  const rule = rowToAlertRule({
    id: "SPY:flip-cross:1",
    ticker: "SPY",
    kind: "flip-cross",
    tolerance_pct: null,
    enabled: false,
  });
  assert.equal("tolerancePct" in rule, false);
  assert.equal(rule.enabled, false);
});

test("rowToAlertRule: coerces a string numeric column (defensive) and drops non-finite garbage", () => {
  const withStringTol = rowToAlertRule({
    id: "a", ticker: "SPY", kind: "wall-touch", tolerance_pct: "0.001" as unknown as number, enabled: true,
  });
  assert.equal(withStringTol.tolerancePct, 0.001);

  const withGarbage = rowToAlertRule({
    id: "b", ticker: "SPY", kind: "wall-touch", tolerance_pct: "not-a-number" as unknown as number, enabled: true,
  });
  assert.equal("tolerancePct" in withGarbage, false);
});

test("sanitizeIncomingRules: keeps only well-formed rules and forces the URL-scoped ticker", () => {
  const out = sanitizeIncomingRules("SPY", [
    { id: "x1", ticker: "SOMETHING-ELSE", kind: "wall-touch", tolerancePct: 0.001, enabled: true },
    { id: "x2", ticker: "SPY", kind: "flip-cross", enabled: true },
    // Malformed entries below must all be dropped silently, not throw.
    { id: "", kind: "wall-touch", enabled: true },
    { id: "x3", kind: "not-a-real-kind", enabled: true },
    { id: "x4", kind: "wall-touch" }, // missing enabled
    null,
    "just a string",
    42,
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.ticker, "SPY", "client-supplied ticker never overrides the URL-scoped ticker");
  assert.equal(out[0]!.tolerancePct, 0.001);
  assert.equal(out[1]!.kind, "flip-cross");
  assert.equal("tolerancePct" in out[1]!, false);
});

test("sanitizeIncomingRules: drops tolerancePct on a flip-cross rule even if the client sent one", () => {
  const out = sanitizeIncomingRules("SPY", [
    { id: "y1", kind: "flip-cross", enabled: true, tolerancePct: 0.05 },
  ]);
  assert.equal(out.length, 1);
  assert.equal("tolerancePct" in out[0]!, false);
});

test("sanitizeIncomingRules: non-array input returns []", () => {
  assert.deepEqual(sanitizeIncomingRules("SPY", null), []);
  assert.deepEqual(sanitizeIncomingRules("SPY", "nope"), []);
  assert.deepEqual(sanitizeIncomingRules("SPY", undefined), []);
});

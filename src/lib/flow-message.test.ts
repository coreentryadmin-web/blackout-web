import assert from "node:assert/strict";
import test from "node:test";

import { decodeFlowMessage, encodeFlowMessage } from "./flow-message";

// decodeFlowMessage only inspects `ticker` at runtime, so a partial object suffices.
const MY_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";

function baseFlow() {
  return { ticker: "SPY", id: "f1", premium: 1000 } as unknown as Parameters<typeof encodeFlowMessage>[1];
}

test("own-loopback is skipped (returns null)", () => {
  const wire = encodeFlowMessage(MY_ID, baseFlow());
  assert.equal(decodeFlowMessage(wire, MY_ID), null);
});

test("remote message is fanned (returns the flow)", () => {
  const wire = encodeFlowMessage(OTHER_ID, baseFlow());
  const decoded = decodeFlowMessage(wire, MY_ID);
  assert.ok(decoded);
  assert.equal(decoded?.ticker, "SPY");
});

test("bare flow without __origin is back-compat fanned", () => {
  const wire = JSON.stringify({ ticker: "QQQ", id: "f2" });
  const decoded = decodeFlowMessage(wire, MY_ID);
  assert.ok(decoded);
  assert.equal(decoded?.ticker, "QQQ");
});

test("__origin is stripped before fan-out", () => {
  const wire = encodeFlowMessage(OTHER_ID, baseFlow());
  const decoded = decodeFlowMessage(wire, MY_ID) as Record<string, unknown> | null;
  assert.ok(decoded);
  assert.equal(Object.prototype.hasOwnProperty.call(decoded, "__origin"), false);
});

test("invalid JSON returns null", () => {
  assert.equal(decodeFlowMessage("not json {", MY_ID), null);
});

test("missing ticker returns null", () => {
  const wire = JSON.stringify({ __origin: OTHER_ID, id: "f3" });
  assert.equal(decodeFlowMessage(wire, MY_ID), null);
});

test("non-object JSON (primitive / null) returns null", () => {
  assert.equal(decodeFlowMessage("123", MY_ID), null);
  assert.equal(decodeFlowMessage('"SPY"', MY_ID), null);
  assert.equal(decodeFlowMessage("null", MY_ID), null);
});

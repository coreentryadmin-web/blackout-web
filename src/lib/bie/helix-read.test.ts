import test from "node:test";
import assert from "node:assert/strict";
import { optionSideSuffix, parseHelixReadIntent } from "./helix-read-intent";

// ── optionSideSuffix ─────────────────────────────────────────────────────────
// The bug: the print list compared option_type to lowercase "put" and the stack list to lowercase
// "call", but every producer emits UPPERCASE ("CALL"/"PUT"). So "PUT" === "put" was always false —
// puts rendered as calls in one section, calls rendered as puts in the next.

test("optionSideSuffix: uppercase CALL/PUT map correctly (the real production casing)", () => {
  assert.equal(optionSideSuffix("CALL"), "c");
  assert.equal(optionSideSuffix("PUT"), "p");
});

test("optionSideSuffix: a PUT is NEVER rendered as a call (the exact regression)", () => {
  assert.notEqual(optionSideSuffix("PUT"), "c");
  assert.notEqual(optionSideSuffix("CALL"), "p");
});

test("optionSideSuffix: case- and format-insensitive (lowercase, bare C/P)", () => {
  for (const call of ["call", "Call", "C", "c", "CALL"]) assert.equal(optionSideSuffix(call), "c");
  for (const put of ["put", "Put", "P", "p", "PUT"]) assert.equal(optionSideSuffix(put), "p");
});

test("optionSideSuffix: an unknown/missing side is '?', never a guessed side", () => {
  for (const bad of [null, undefined, "", "unknown", "X"]) {
    assert.equal(optionSideSuffix(bad), "?", `${String(bad)} must not be asserted as call or put`);
  }
});

// ── parseHelixReadIntent ─────────────────────────────────────────────────────
// Order-selection: biggest-prints wants premium order; every other read wants the recent session
// (strike stacks are a rolling signal). Feeding stacks a premium-ordered top-50 answers "what is
// stacking now" with the biggest prints of two days — the get_helix_derived / compare-card defect.

test("parseHelixReadIntent: 'top N' asks premium order and carries the clamped N", () => {
  assert.deepEqual(parseHelixReadIntent("top 5 prints on NVDA"), {
    order: "premium",
    topN: 5,
    listOnly: false,
  });
  assert.equal(parseHelixReadIntent("top 99 prints").topN, 10, "clamped to 10");
  assert.equal(parseHelixReadIntent("top 0 prints").topN, 1, "clamped to >= 1");
});

test("parseHelixReadIntent: 'biggest prints' / 'by premium' / 'list only' ask premium order", () => {
  for (const q of ["biggest prints right now", "prints by premium", "list only please"]) {
    assert.equal(parseHelixReadIntent(q).order, "premium", q);
    assert.equal(parseHelixReadIntent(q).listOnly, true, q);
  }
});

test("parseHelixReadIntent: a general analytics question asks the RECENT session", () => {
  for (const q of ["what is stacking on NVDA", "any unusual flow", undefined]) {
    const intent = parseHelixReadIntent(q);
    assert.equal(intent.order, "recent", String(q));
    assert.equal(intent.topN, null);
    assert.equal(intent.listOnly, false);
  }
});

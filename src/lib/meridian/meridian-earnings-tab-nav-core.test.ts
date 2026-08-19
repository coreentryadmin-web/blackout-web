import assert from "node:assert/strict";
import { test } from "node:test";
import {
  earningsTabForDimension,
  earningsTabNavLabel,
} from "./meridian-earnings-tab-nav-core";

test("earningsTabForDimension maps report rings to the tab that holds full evidence", () => {
  assert.equal(earningsTabForDimension("FLOW"), "positioning");
  assert.equal(earningsTabForDimension("STRUCTURE"), "positioning");
  assert.equal(earningsTabForDimension("SENTIMENT"), "estimates");
  assert.equal(earningsTabForDimension("CATALYST"), "estimates");
  assert.equal(earningsTabForDimension("HISTORY"), "history");
});

test("earningsTabNavLabel returns member-facing tab names", () => {
  assert.equal(earningsTabNavLabel("positioning"), "Positioning");
  assert.equal(earningsTabNavLabel("history"), "History");
});

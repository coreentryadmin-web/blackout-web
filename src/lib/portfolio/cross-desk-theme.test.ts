import { test } from "node:test";
import assert from "node:assert/strict";
import { crossDeskTheme, crossDeskSameThesis } from "./cross-desk-theme.ts";

test("crossDeskTheme: AAPL is megatech (not 0DTE governor's AVGO/CRM cluster)", () => {
  assert.equal(crossDeskTheme("AAPL"), "megatech");
  assert.equal(crossDeskTheme("MSFT"), "megatech");
  assert.notEqual(crossDeskTheme("AVGO"), "megatech");
  assert.equal(crossDeskTheme("AVGO"), "semis");
});

test("crossDeskSameThesis: megatech names cluster; AVGO does not merge with AAPL cross-desk", () => {
  assert.equal(crossDeskSameThesis("AAPL", "MSFT"), true);
  assert.equal(crossDeskSameThesis("AAPL", "AVGO"), false);
});

test("crossDeskTheme: unmapped ticker is its own cluster", () => {
  assert.equal(crossDeskTheme("ZZZQ"), "NAME:ZZZQ");
  assert.equal(crossDeskSameThesis("ZZZQ", "ZZZR"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNightHawkDeskTheme } from "./nighthawk-desk-theme";

test("parseNightHawkDeskTheme accepts dark and light only", () => {
  assert.equal(parseNightHawkDeskTheme("dark"), "dark");
  assert.equal(parseNightHawkDeskTheme("light"), "light");
  assert.equal(parseNightHawkDeskTheme("system"), null);
  assert.equal(parseNightHawkDeskTheme(null), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNightHawkDeskTheme, systemNightHawkDeskTheme } from "./nighthawk-desk-theme";

test("parseNightHawkDeskTheme accepts dark and light only", () => {
  assert.equal(parseNightHawkDeskTheme("dark"), "dark");
  assert.equal(parseNightHawkDeskTheme("light"), "light");
  assert.equal(parseNightHawkDeskTheme("system"), null);
  assert.equal(parseNightHawkDeskTheme(null), null);
});

test("systemNightHawkDeskTheme defaults to dark (not OS preference)", () => {
  assert.equal(systemNightHawkDeskTheme(), "dark");
});

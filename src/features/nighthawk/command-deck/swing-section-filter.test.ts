import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowsForSwingSection,
  swingSectionCounts,
  emptySwingSectionHint,
  SWING_SECTION_LABEL,
} from "./swing-section-filter";
import { SWING_SERVING_SECTIONS } from "@/lib/swing/serving";

const sections = {
  COMMIT_NOW: [{ ticker: "AAA" }],
  WAITING_FOR_ENTRY: [{ ticker: "BBB" }, { ticker: "CCC" }],
  WATCH: [{ ticker: "DDD" }],
  // RESEARCH deliberately absent — an absent bucket must behave exactly like an empty one.
  MANAGING: [{ ticker: "EEE" }],
  SCALING_OUT: [],
  EXITING: [{ ticker: "FFF" }],
};

test("rowsForSwingSection: ALL concatenates in canonical section order", () => {
  // Pre-entry buckets first, then live-position — the order a member reads the board in:
  // what can I act on, then what am I already in.
  assert.deepEqual(
    rowsForSwingSection(sections, "ALL").map((r) => r.ticker),
    ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
  );
});

test("rowsForSwingSection: a specific section returns only that section", () => {
  assert.deepEqual(rowsForSwingSection(sections, "WAITING_FOR_ENTRY").map((r) => r.ticker), ["BBB", "CCC"]);
  assert.deepEqual(rowsForSwingSection(sections, "SCALING_OUT"), []);
  assert.deepEqual(rowsForSwingSection(sections, "RESEARCH"), [], "absent bucket behaves as empty");
});

test("rowsForSwingSection: null/undefined sections yield an empty list, never throw", () => {
  assert.deepEqual(rowsForSwingSection(null, "ALL"), []);
  assert.deepEqual(rowsForSwingSection(undefined, "COMMIT_NOW"), []);
});

test("swingSectionCounts: every section is present even at zero", () => {
  const c = swingSectionCounts(sections);
  // The point of the fix: an empty COMMIT_NOW must be VISIBLE as 0, not silently dropped —
  // "nothing is actionable right now" is real information a member needs.
  for (const s of SWING_SERVING_SECTIONS) {
    assert.equal(typeof c[s], "number", `${s} missing from counts`);
  }
  assert.equal(c.SCALING_OUT, 0);
  assert.equal(c.RESEARCH, 0, "absent bucket counts as 0, not undefined");
  assert.equal(c.WAITING_FOR_ENTRY, 2);
  assert.equal(c.ALL, 6, "ALL is the sum of the seven");
});

test("swingSectionCounts: ALL equals the length of the ALL rows", () => {
  assert.equal(swingSectionCounts(sections).ALL, rowsForSwingSection(sections, "ALL").length);
});

test("emptySwingSectionHint: explains a filtered-empty section without claiming the lane is empty", () => {
  const c = swingSectionCounts(sections);
  const hint = emptySwingSectionHint("SCALING_OUT", c);
  assert.ok(hint, "an empty section inside a populated lane must explain itself");
  assert.match(hint!, /SCALING/);
  assert.match(hint!, /6 in other sections/);
});

test("emptySwingSectionHint: silent when the section has rows, or on ALL", () => {
  const c = swingSectionCounts(sections);
  assert.equal(emptySwingSectionHint("COMMIT_NOW", c), null);
  assert.equal(emptySwingSectionHint("ALL", c), null);
});

test("emptySwingSectionHint: defers to the lane-level hint when the whole lane is empty", () => {
  // With nothing anywhere, "no names in X, 0 in other sections" would be noise on top of the
  // caller's own (better) empty-lane copy.
  const empty = swingSectionCounts({});
  assert.equal(emptySwingSectionHint("COMMIT_NOW", empty), null);
});

test("SWING_SECTION_LABEL covers ALL plus every section", () => {
  assert.equal(typeof SWING_SECTION_LABEL.ALL, "string");
  for (const s of SWING_SERVING_SECTIONS) {
    assert.equal(typeof SWING_SECTION_LABEL[s], "string", `${s} has no button label`);
    assert.ok(SWING_SECTION_LABEL[s].length <= 9, `${s} label too wide for the mobile filter row`);
  }
});

// Live regression from #1836, reported off the desk 2026-08-07: the section bar rendered as eight
// ~400px-tall panels covering the board. Two CSS facts caused it, and both are pinned here because
// the failure is invisible to any test that only renders markup.
test("the section bar does NOT reuse the compact-header --prominent modifier", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("./containers.tsx", import.meta.url)), "utf8");
  const bar = src.slice(
    src.indexOf('aria-label="Filter swing plays by serving section"') - 400,
    src.indexOf('aria-label="Filter swing plays by serving section"') + 60
  );
  assert.ok(
    bar.includes("nh-deck-filterbar--sections"),
    "the section bar must use its own --sections modifier"
  );
  assert.ok(
    !bar.includes("nh-deck-filterbar--prominent"),
    "--prominent is `flex:1 1 auto` for a flex ROW (the compact header); in this flex COLUMN that " +
      "reads as 'take the leftover HEIGHT' and the bar swallows the whole deck"
  );
});

test("--sections pins both halves of the bug: never grow, never stretch", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const css = readFileSync(
    fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
    "utf8"
  );
  const rule = css.slice(
    css.indexOf(".nh-deck-filterbar--sections{"),
    css.indexOf(".nh-deck-filterbar--sections::-webkit-scrollbar")
  );
  assert.ok(rule.length > 0, ".nh-deck-filterbar--sections rule not found");
  assert.match(rule, /flex:0 0 auto/, "must not grow into the column's spare height");
  // `.nh-deck-filterbar` sets no align-items, so the default `stretch` is what made every button
  // as tall as the bar. The modifier has to override it explicitly.
  assert.match(rule, /align-items:center/, "must not let buttons stretch to the bar's height");
});

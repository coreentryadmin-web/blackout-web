import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPX_DESK_MAX_PAIN_LABEL,
  SPX_DESK_MAX_PAIN_LABEL_IOS,
  SPX_PIN_MAX_PAIN_LABEL,
  SPX_PIN_MAX_PAIN_LABEL_PROSE,
} from "./spx-metric-labels";

/** Compare the way a member reads a label, not the way a string equality does. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "");

test("the desk and pin max-pain labels are distinct to a reader, not just to ===", () => {
  // Bare "Max Pain" vs "EFF MAX PAIN" would pass a `!==` check while still colliding for anyone
  // who reads past the qualifier, so normalize first: the two must differ in their WORDS.
  assert.notEqual(normalize(SPX_DESK_MAX_PAIN_LABEL), normalize(SPX_PIN_MAX_PAIN_LABEL));
  assert.notEqual(normalize(SPX_DESK_MAX_PAIN_LABEL_IOS), normalize(SPX_PIN_MAX_PAIN_LABEL));
  assert.notEqual(normalize(SPX_DESK_MAX_PAIN_LABEL_IOS), normalize(SPX_PIN_MAX_PAIN_LABEL_PROSE));
});

test("every max-pain label carries a basis qualifier — none is the bare term", () => {
  // The defect was a BARE label, not a wrong one. Assert the property that was missing rather than
  // the specific words, so a future rename to another honest qualifier still passes.
  for (const label of [
    SPX_DESK_MAX_PAIN_LABEL,
    SPX_DESK_MAX_PAIN_LABEL_IOS,
    SPX_PIN_MAX_PAIN_LABEL,
    SPX_PIN_MAX_PAIN_LABEL_PROSE,
  ]) {
    assert.notEqual(normalize(label), "maxpain", `"${label}" is the bare term — it names no basis`);
    assert.ok(normalize(label).length > "maxpain".length, `"${label}" adds no qualifier`);
  }
});

test("the desktop and iOS desk labels name the SAME basis as each other", () => {
  // Two surfaces showing one quantity must not disagree about what it is. They differ only in case.
  assert.equal(normalize(SPX_DESK_MAX_PAIN_LABEL), normalize(SPX_DESK_MAX_PAIN_LABEL_IOS));
});

test("labels stay short enough for a phone metric row", () => {
  // .spx-ios-metric-row is a 10px flex row with space-between — there is real headroom, but a
  // label that grows without bound would push the value off. 16 chars ≈ 90px at 10px, well inside
  // a 390px viewport.
  assert.ok(SPX_DESK_MAX_PAIN_LABEL_IOS.length <= 16, SPX_DESK_MAX_PAIN_LABEL_IOS);
});

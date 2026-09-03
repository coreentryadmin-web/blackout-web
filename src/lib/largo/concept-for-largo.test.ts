import assert from "node:assert/strict";
import { test } from "node:test";
import { conceptForLargo } from "./concept-for-largo";

test("conceptForLargo resolves glossary hits", () => {
  const hit = conceptForLargo({ question: "what is gamma flip" });
  assert.equal(hit.found, true);
  assert.match(String(hit.term), /flip/i);
  assert.ok(String(hit.definition).length > 20);
});

test("conceptForLargo returns honest miss for unknown terms", () => {
  const miss = conceptForLargo({ term: "flongle indicator" });
  assert.equal(miss.found, false);
  assert.match(String(miss.note), /not in the BlackOut glossary/i);
});

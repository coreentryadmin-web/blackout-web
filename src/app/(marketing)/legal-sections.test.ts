import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The legal pages number their own sections in the JSX text ("<h2>7. Data Retention</h2>").
 * Nothing derives those numbers, so inserting a section means hand-renumbering every one
 * below it — and a search/replace that walks the numbers in the wrong order silently
 * produces a policy that reads 6, 8, 7, 9. That is invisible to tsc, to lint, and to a
 * skimmed diff, but a regulator or an app reviewer reads these pages top to bottom.
 */
const PAGES = [
  "src/app/(marketing)/privacy/page.tsx",
  "src/app/(marketing)/terms/page.tsx",
];

for (const page of PAGES) {
  test(`${page} numbers its sections 1..N with no gaps, repeats, or swaps`, () => {
    const src = readFileSync(page, "utf8");
    const numbers = [...src.matchAll(/<h2>(\d+)\. /g)].map((m) => Number(m[1]));

    assert.ok(numbers.length > 0, "expected at least one numbered <h2> section");
    assert.deepEqual(
      numbers,
      numbers.map((_, i) => i + 1),
      `sections are out of order: ${numbers.join(", ")}`
    );
  });
}

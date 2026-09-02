import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_MANIFEST, MANIFEST_PRODUCT_ORDER } from "@/lib/marketing/product-manifest";

const root = process.cwd();
const src = readFileSync(join(root, "src/components/landing/WhyBlackoutContent.tsx"), "utf8");

// Regression for a P2 finding (2026-09-02): a numbered argument list on /why-blackout ("Why
// BlackOut" trust/conversion page) had a gap — section 3 jumped straight to section 5 in an
// earlier revision, with no section 4. Numbered marketing headings are part of the document
// hierarchy crawlers and AEO systems read, so a gap reads as an incompletely edited page on
// a page whose whole job is to establish credibility. Asserts the numbered "## N. " headings
// in the BODY markdown are a contiguous 1..N sequence with no gaps or duplicates.
test("the numbered '## N. ' headings on /why-blackout form a contiguous sequence with no gaps", () => {
  const numbers = [...src.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.ok(numbers.length >= 2, "expected multiple numbered headings on /why-blackout");
  const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);
  assert.deepEqual(numbers, expected, `numbered headings must run 1..${numbers.length} with no gaps, got [${numbers.join(", ")}]`);
});

// The same page also once said "Six tools, one desk:" while listing only six of the (by then)
// seven live products — Meridian was added to the manifest without updating this hardcoded
// count/word. Assert the count is derived, not a hardcoded number word, and every live
// product's label actually appears in the list.
test("/why-blackout's tool count is derived from the manifest, not a hardcoded number word", () => {
  assert.doesNotMatch(src, /\b(One|Two|Three|Four|Five|Six|Seven|Eight|Nine) tools, one desk/, "tool count must not be a hardcoded number word");
  assert.match(src, /\$\{manifestProductCount\(\)\} tools, one desk/);
});

test("/why-blackout's tool list names every live product in the manifest", () => {
  for (const id of MANIFEST_PRODUCT_ORDER) {
    const entry = PRODUCT_MANIFEST[id];
    if (entry.launchStatus !== "live") continue;
    assert.match(src, new RegExp(entry.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `live product "${entry.label}" is missing from the /why-blackout tool list`);
  }
});

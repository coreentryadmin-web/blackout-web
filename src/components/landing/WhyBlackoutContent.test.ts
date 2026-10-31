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

// Regression for a P2 finding (2026-09-03): the "12,400+" figure is a real, measured number —
// Polygon's grouped-daily endpoint returns every US stock for a session (~12,400/day,
// scripts/audit/market-banger-scan.mjs and docs/audit/0DTE-RESEARCH.md both document this) — but
// the marketing copy mislabeled it "contracts" (options-chain entries), a metric that is never
// actually computed anywhere in the codebase. The claim was false as written: BlackOut screens
// ~12,400 STOCKS daily, not 12,400 options contracts.
test("the 12,400+ daily-screen figure is labeled stocks/tickers, never contracts (unmeasured metric)", () => {
  assert.doesNotMatch(src, /12,400\+?\s+contracts/i, "12,400+ is a real stock-universe count, not a contract count — never label it 'contracts'");
});

// Regression (found 2026-10-31, round 165 audit): #1944's breadcrumbs fix added
// `import type { ReactNode } from "react";` ABOVE the pre-existing `"use client";`
// directive. A directive only takes effect as the FIRST statement in the module (same
// rule as "use strict") — any statement before it, even a type-only import that is
// erased at compile time, demotes the literal to an ordinary no-op expression statement.
// Every other "use client" file in this repo (grep -rl '"use client"' src) puts the
// directive first; this was the only exception, left silently inert for over a year.
// It happened not to break anything because this component uses no hooks/browser APIs
// of its own (MarkdownBody, which it renders, declares its own "use client"), but the
// NEXT edit that adds a `useState`/`useEffect` here would hard-fail `next build` with
// "You're importing a component that needs client-only ..." — see client-server-
// boundary.test.ts's doc comment for exactly that failure shape elsewhere in the repo.
test('"use client" is the literal first line — not merely present, but a real directive', () => {
  const firstNonBlankLine = src.split("\n").find((l) => l.trim().length > 0);
  assert.equal(
    firstNonBlankLine?.trim(),
    '"use client";',
    `"use client" must be the first statement in the file (before even a type-only import) ` +
      `to take effect as a module directive; got: ${JSON.stringify(firstNonBlankLine)}`
  );
});

test("/why-blackout's tool list names every live product in the manifest", () => {
  for (const id of MANIFEST_PRODUCT_ORDER) {
    const entry = PRODUCT_MANIFEST[id];
    if (entry.launchStatus !== "live") continue;
    assert.match(src, new RegExp(entry.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `live product "${entry.label}" is missing from the /why-blackout tool list`);
  }
});

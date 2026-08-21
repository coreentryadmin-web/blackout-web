import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CLIPPED vs CAPPED, pinned as source shape.
 *
 * The predicate runs inside the browser via page.evaluate, so it cannot be imported and unit
 * tested — the same constraint `ui-geometry-probe.mjs` lives with. What CAN be pinned is that the
 * narrowing exists and is narrow: the recovery walk present, and the underlying clip test intact
 * so this never becomes "stop reporting clipped text".
 */
const SRC = readFileSync(join(process.cwd(), "scripts/audit/meridian-interaction-audit.mjs"), "utf8");
const PREDICATE = /const clipped = boxes[\s\S]*?\.map\(\(\{ t \}\) => t\);/.exec(SRC)?.[0] ?? "";

test("the clip check still detects clipped text at all", () => {
  // The failure mode of a false-positive fix is deleting the check. The geometry test and the
  // overflow test both have to survive, or nothing is being measured any more.
  assert.ok(PREDICATE, "the clipped predicate must still exist");
  assert.match(PREDICATE, /scrollWidth > el\.clientWidth \+ 1/, "the geometry test must survive");
  assert.match(PREDICATE, /getComputedStyle\(el\)\.overflow === "visible"/, "the overflow test must survive");
});

test("a clip is excused only when the full text is recoverable from a title or accessible name", () => {
  // Narrow on purpose: recoverable means SOMETHING spells the text out. Anything else still reports.
  assert.match(PREDICATE, /getAttribute\("title"\)/, "must consult title");
  assert.match(PREDICATE, /getAttribute\("aria-label"\)/, "must consult the accessible name");
  assert.match(PREDICATE, /\.includes\(full\)/, "must require the carried text to CONTAIN the clipped text");
  // An ancestor walk, because the capped label and the control that names it are different nodes.
  assert.match(PREDICATE, /parentElement/, "must walk ancestors, not just the element itself");
  // ...and it must stop at body rather than running off the top of the document.
  assert.match(PREDICATE, /!== document\.body/, "the walk must terminate at body");
});

test("empty text is never reported as clipped", () => {
  // A zero-height spacer or an icon-only span can trip scrollWidth without having anything to cut
  // off. Reporting those is how a clip list fills with entries nobody can act on.
  assert.match(PREDICATE, /if \(!full\) return false;/);
});

test("the exclusion is documented with the case that motivated it", () => {
  // An exclusion whose reason is not written down gets deleted by the next person as unexplained,
  // or worse, widened. This file's header makes exactly that argument about its own heuristics.
  const doc = SRC.slice(Math.max(0, SRC.indexOf("CLIPPED, as opposed to CAPPED") - 200), SRC.indexOf("const clipped = boxes"));
  assert.match(doc, /ms-orb-label/, "name the element that motivated it");
  assert.match(doc, /title/i);
  assert.match(doc, /hover/i, "note the second recovery path");
});

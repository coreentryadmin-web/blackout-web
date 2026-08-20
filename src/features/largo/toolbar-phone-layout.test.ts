import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two phone defects, both found by SCREENSHOT after the probes said clean.
 *
 * MEASURED ON PROD 2026-08-20 at 430x932, twice, 8 minutes apart:
 *   1. "Largo Terminal" X "Concrete" overlapping 30x20px — the toolbar rendered as
 *      "LARGO TERM(IN)CONCRETE".
 *   2. The Historical button measured 15x15 — under the 24px minimum tap target.
 *
 * HOW BOTH ESCAPED AUTOMATION. The first probe measured horizontal overflow (0px) and clipped text
 * (0) and reported the page healthy. Overlapping text does NEITHER — it does not overflow the page
 * and nothing clips it. A second probe added collision detection and over-reported (8 hits, 7 of
 * which named text not on the page — boxes overlap, pixels do not). A third added
 * `elementFromPoint` hit-testing and under-reported (0 hits, missing the real one — the lower text
 * paints under a TRANSPARENT tab background, so the hit test rejects it as "covered").
 *
 * The screenshot was right all three times. This is precisely the trap
 * `meridian-interaction-audit` was built for: "a panel whose labels overlap into garbage satisfies
 * every one of its assertions."
 */

const root = process.cwd();
const CSS = readFileSync(join(root, "src/app/globals.css"), "utf8");
const TOOLBAR = readFileSync(
  join(root, "src/features/largo/components/LargoTerminalToolbar.tsx"),
  "utf8"
);

function rule(selector: string): string {
  const at = CSS.indexOf(`  ${selector} {`);
  assert.notEqual(at, -1, `${selector} must exist`);
  return CSS.slice(at, CSS.indexOf("\n  }", at));
}

test("REGRESSION: the toolbar name can clip instead of painting over the buttons", () => {
  // `nowrap` with no overflow handling is the whole defect: the text neither shrinks, wraps nor
  // clips, so it spills across `.largo-toolbar-actions` (which is flex-shrink: 0).
  const name = rule(".largo-toolbar-name");
  assert.match(name, /white-space:\s*nowrap/, "precondition: it still may not wrap");
  assert.match(name, /overflow:\s*hidden/, "…so it MUST be able to clip");
  assert.match(name, /text-overflow:\s*ellipsis/);
});

test("the brand can actually shrink, or the ellipsis never engages", () => {
  // A flex item defaults to min-width:auto and will not shrink below its content; without
  // overflow:hidden on the parent the child's ellipsis is inert and the text escapes the box.
  const brand = rule(".largo-toolbar-brand");
  assert.match(brand, /min-width:\s*0/);
  assert.match(brand, /overflow:\s*hidden/);
});

test("the sub-label's guard is unchanged — it was always the correct pattern", () => {
  // `.largo-toolbar-sub` already carried exactly this pair. The name was simply missed, which is
  // why the fix is "match the sibling" rather than a new approach.
  const sub = rule(".largo-toolbar-sub");
  assert.match(sub, /overflow:\s*hidden/);
  assert.match(sub, /text-overflow:\s*ellipsis/);
});

test("REGRESSION: no toolbar button collapses to nothing when labels are hidden", () => {
  // At <=640px `.largo-toolbar-btn-label { display: none }`. Any button whose ONLY child is that
  // label becomes an empty ~15x15 box. Historical was the sole offender; every sibling already had
  // an icon. Asserted structurally so a NEW icon-less button fails here rather than on a phone.
  const buttons = TOOLBAR.match(/<button[\s\S]*?<\/button>/g) ?? [];
  const toolbarBtns = buttons.filter((b) => b.includes("largo-toolbar-btn"));
  assert.ok(toolbarBtns.length >= 4, `expected the real toolbar, saw ${toolbarBtns.length}`);
  for (const b of toolbarBtns) {
    const hasLabel = b.includes("largo-toolbar-btn-label");
    if (!hasLabel) continue;
    assert.match(
      b,
      /<[A-Z][A-Za-z]*\s+size=\{\d+\}/,
      `a toolbar button with a hide-on-mobile label must also carry an icon: ${b.slice(0, 120)}`
    );
  }
});

test("the mobile label-hiding rule still exists — the fix depends on it", () => {
  assert.match(CSS, /\.largo-toolbar-btn-label \{\s*display: none;/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the mobile Vector desk chart-collapse fix (P1: chart never rendered below 1280px).
 *
 * Root cause: `.vector-page-shell .vector-chart-wrap` / `.vector-chart-stage` /
 * `.vector-chart-terminal-chart` carried an unconditional `flex: 1 1 0` + `min-height: 0`
 * flex-fill chain. That is only correct once some ancestor has a DEFINITE height for flex-grow
 * to distribute against — true from 1280px up (the `@media (min-width: 1280px)` block caps
 * `.vector-page-shell` to `height: 100dvh` and flex-fills every level down to the grid) and NOT
 * true below it (plain document flow, no definite height anywhere in the chain). With no space
 * to grow into and the default min-content floor (`min-height: auto`) explicitly zeroed out, the
 * whole chain collapsed to a literal 0px box below 1280px — even though the canvas itself
 * (`.vector-chart-canvas--desk-fill`) still forced `min-height: 320px !important` in isolation.
 * `.vector-chart-stage`'s `overflow: hidden` then clipped that 320px canvas out of view inside
 * its own 0px parent, so the chart was unconditionally in the DOM and never visible on screen at
 * any mobile width. Verified live at 430x932 (fresh Clerk session, `.vector-chart-canvas`
 * measured h=320 while `.vector-chart-stage`/`.vector-chart-wrap`/`.vector-chart-terminal-chart`
 * all measured h=0, unchanged after a 30s settle — not a data/timing race).
 *
 * Fix: only apply `flex: 1 1 0` + `min-height: 0` to this chain at >=1280px (where a definite
 * ancestor height exists), letting the mobile/base rule fall back to the default `flex: 0 1 auto`
 * + `min-height: auto` so a flex column with one child sizes to that child's natural content
 * height — identical to plain block stacking here, and the mechanism that lets the canvas's own
 * 320px floor propagate up through every ancestor instead of being discarded.
 *
 * This is a pure CSS layout bug jsdom cannot reproduce (no real flexbox layout engine), so —
 * following the precedent in nh-deck-mobile-css.test.ts / toolbar-phone-layout.test.ts — this
 * asserts against the raw stylesheet text: the base (mobile-inclusive) rule must NOT force
 * flex-basis/min-height to 0, and the >=1280px block must still apply them (byte-identical to
 * what the base rule carried before the fix), so desktop's geometry is unchanged.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function sliceBetween(startRe: RegExp, endRe: RegExp, label: string): string {
  const startMatch = css.match(startRe);
  assert.ok(startMatch && startMatch.index != null, `${label}: start anchor not found`);
  const start = startMatch.index! + startMatch[0].length;
  const rest = css.slice(start);
  const endMatch = rest.match(endRe);
  assert.ok(endMatch && endMatch.index != null, `${label}: end anchor not found`);
  return rest.slice(0, endMatch.index);
}

// From the mobile/stacked `.vector-page-shell .vector-chart-terminal-grid` floor rule up to the
// real `@media (min-width: 1280px) {` block start (comment mentions of that string lack the
// trailing brace, so they don't false-match).
const mobileBlock = sliceBetween(
  /\.vector-page-shell \.vector-chart-terminal-grid \{\s*min-height: calc\(100dvh - 7rem\);/,
  /@media \(min-width: 1280px\) \{/,
  "mobile chart-fill block",
);

// The >=1280px block itself (bounded to a generous span so it doesn't run into the 1600px block).
const desktopBlock = sliceBetween(
  /@media \(min-width: 1280px\) \{/,
  /@media \(min-width: 1600px\) \{/,
  "desktop (>=1280px) chart-fill block",
);

test("mobile base rules do NOT force the chart flex-fill chain to 0", () => {
  // .vector-chart-terminal-chart / .vector-chart-wrap / .vector-chart-stage must each appear in
  // the mobile block WITHOUT `flex: 1 1 0` or `min-height: 0` — that combination is what collapsed
  // them to a literal 0px box with no definite ancestor height to grow into.
  for (const selector of [
    "\\.vector-chart-terminal-chart",
    "\\.vector-chart-wrap",
    "\\.vector-chart-stage",
  ]) {
    const ruleRe = new RegExp(`\\.vector-page-shell ${selector} \\{([^}]*)\\}`);
    const m = mobileBlock.match(ruleRe);
    assert.ok(m, `.vector-page-shell ${selector.replace(/\\/g, "")} rule not found in mobile block`);
    const body = m![1];
    assert.doesNotMatch(
      body,
      /flex:\s*1 1 0/,
      `.vector-page-shell ${selector.replace(/\\/g, "")} must not force flex:1 1 0 below 1280px`,
    );
    assert.doesNotMatch(
      body,
      /min-height:\s*0\b/,
      `.vector-page-shell ${selector.replace(/\\/g, "")} must not force min-height:0 below 1280px`,
    );
  }

  // The canvas itself keeps its unconditional 320px floor — untouched by this fix.
  assert.match(mobileBlock, /\.vector-page-shell \.vector-chart-canvas--desk-fill \{[^}]*min-height: 320px !important/);
});

test(">=1280px block re-applies the flex-fill chain (desktop geometry unchanged)", () => {
  assert.match(
    desktopBlock,
    /\.vector-page-shell \.vector-chart-wrap \{\s*flex: 1 1 0;\s*min-height: 0;\s*\}/,
    "desktop block must still flex-fill .vector-chart-wrap",
  );
  assert.match(
    desktopBlock,
    /\.vector-page-shell \.vector-chart-stage \{\s*flex: 1 1 0;\s*min-height: 0;\s*\}/,
    "desktop block must still flex-fill .vector-chart-stage",
  );
  assert.match(
    desktopBlock,
    /\.vector-page-shell \.vector-chart-terminal-chart \{\s*min-height: 0;\s*\}/,
    "desktop block must still zero .vector-chart-terminal-chart's min-height",
  );
});

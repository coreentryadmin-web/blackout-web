import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A `type="number"` input captures the wheel event by default in Chrome/Firefox — scrolling
 * the page while the cursor happens to sit over a FOCUSED number input silently changes its
 * value instead of scrolling the page. Every such input in Vector/Helix sits inside a small
 * popover/panel (alerts tolerance, custom chart interval, alert threshold) where this is a
 * real, easy-to-trigger footgun, not a theoretical one. The fix is `onWheel={(e) =>
 * e.currentTarget.blur()}` — a scroll always scrolls, never mutates.
 *
 * Source-grep rather than full RTL rendering, matching this repo's established convention for
 * cheap, direct regression coverage of a JSX prop (see MembershipActivatingBanner.test.ts,
 * Modal.test.ts).
 */
const FILES_WITH_NUMBER_INPUTS = [
  "src/features/vector/components/VectorAlertsPanel.tsx",
  "src/features/vector/components/VectorTimeframeSelect.tsx",
  "src/features/helix/components/HelixTickerAlertToggle.tsx",
];

for (const relPath of FILES_WITH_NUMBER_INPUTS) {
  test(`${relPath}: every type="number" input guards against accidental scroll-wheel mutation`, () => {
    const src = readFileSync(join(process.cwd(), relPath), "utf8");
    const numberInputCount = (src.match(/type="number"/g) ?? []).length;
    const wheelGuardCount = (src.match(/onWheel=\{\(e\) => e\.currentTarget\.blur\(\)\}/g) ?? [])
      .length;
    assert.ok(numberInputCount > 0, `expected to find at least one type="number" input in ${relPath}`);
    assert.equal(
      wheelGuardCount,
      numberInputCount,
      `expected every type="number" input in ${relPath} to have the onWheel blur guard ` +
        `(found ${numberInputCount} number input(s), ${wheelGuardCount} guard(s))`
    );
  });
}

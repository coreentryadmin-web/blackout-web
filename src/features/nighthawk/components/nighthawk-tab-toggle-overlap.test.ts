import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/**
 * Guards the mobile 430x932 defect where the Night Hawk view-tab row's 5th tab
 * ("Legacy") visually overlapped the adjacent theme-toggle pill instead of wrapping,
 * truncating, or scrolling.
 *
 * Root cause: NightHawkFeed.tsx's header row gives <IosNativeSegment> `min-w-0 flex-1
 * shrink` so the segment yields width to the theme-toggle sibling — but every
 * `.ios-native-segment-btn` inside it is `flex: 0 0 auto` (content-width, deliberately
 * non-shrinking; see the "Flat underline tabs" comment in nighthawk-v2.css), and VECTOR
 * made this a 5-tab row. With no overflow handling on the container, once the five
 * non-shrinking buttons' combined width exceeded the box the flex algorithm assigned
 * (min-w-0 removes the default min-content floor that would otherwise have kept the box
 * wide enough), the excess rendered with the CSS-default `overflow: visible` — painting
 * past the container's right edge and on top of the theme toggle, which paints after it
 * in DOM order.
 */

/** Extract one CSS rule's declaration block by its exact selector line (rule bodies here never nest). */
function ruleBody(css: string, selector: string, label: string): string {
  const needle = `${selector} {`;
  const idx = css.indexOf(needle);
  assert.ok(idx >= 0, `${label}: selector "${selector}" not found in nighthawk-v2.css`);
  const open = idx + needle.length - 1;
  const close = css.indexOf("}", open);
  assert.ok(close > open, `${label}: no closing brace found for "${selector}"`);
  return css.slice(open + 1, close);
}

const css = readFileSync(join(root, "src/app/nighthawk-v2.css"), "utf8");

test("nh-v2-page view-tab row scrolls horizontally instead of overflowing onto the theme toggle", () => {
  const segmentRule = ruleBody(css, ".nh-v2-page .ios-native-segment", "view-tab row");
  assert.match(
    segmentRule,
    /overflow-x:\s*auto/,
    "the tab row must contain its overflow (overflow-x: auto) rather than leaving the CSS-default `visible`, " +
      "which is what let 'Legacy' paint on top of the theme-toggle pill at 430px"
  );
  // Scrollbar is intentionally hidden (matches the codebase's existing hidden-horizontal-scroll
  // pattern, e.g. .ios-native-compact-controls) so a thin OS scrollbar doesn't eat into the
  // already-tight 430px row.
  assert.match(segmentRule, /scrollbar-width:\s*none/);

  const webkitScrollbarRule = ruleBody(
    css,
    ".nh-v2-page .ios-native-segment::-webkit-scrollbar",
    "view-tab row webkit scrollbar hide"
  );
  assert.match(webkitScrollbarRule, /display:\s*none/);
});

test("nh-v2-page view-tab buttons stay content-width (fixed by scrolling, not by squashing labels)", () => {
  // The fix must not silently change to "let tabs shrink" — flat, readable tabs are the point
  // of the 2026-08-28 X-Ads-Manager-style redesign this CSS block documents; shrinking would
  // trade the overlap bug for truncated/illegible tab labels instead of fixing it.
  const btnRule = ruleBody(css, ".nh-v2-page .ios-native-segment-btn", "view-tab button");
  assert.match(btnRule, /flex:\s*0 0 auto/);
});

test("NightHawkFeed still pairs a shrinkable segment with a theme-toggle sibling in the header row", () => {
  const tsx = readFileSync(
    join(root, "src/features/nighthawk/components/NightHawkFeed.tsx"),
    "utf8"
  );
  const headerStart = tsx.indexOf("nighthawk-feed-header");
  assert.ok(headerStart >= 0, "nighthawk-feed-header row not found");
  const headerEnd = tsx.indexOf("</div>", tsx.indexOf("NightHawkDeskThemeToggle", headerStart));
  const headerBlock = tsx.slice(headerStart, headerEnd);
  assert.match(
    headerBlock,
    /className="ios-native-desk-segment min-w-0 flex-1 shrink"/,
    "segment must stay min-w-0/flex-1/shrink — that's the layout assumption the CSS overflow-x fix depends on"
  );
  assert.match(headerBlock, /<NightHawkDeskThemeToggle \/>/);
});
